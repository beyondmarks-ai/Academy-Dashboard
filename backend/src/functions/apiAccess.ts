import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth } from "../auth.js";
import { query } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { decryptApiCredential } from "../credentialCrypto.js";

const capability = z.enum([
  "Azure AI Foundry", "Text & Language", "Image Models", "Video Models",
  "Speech & Audio", "Embedding Models", "Realtime Models", "Safety Models",
]);
const deployment = z.enum([
  "gpt-5.6-sol", "gpt-5.6-terra", "text-embedding-3-small", "gpt-image-2",
  "sora-2", "gpt-audio-1.5", "gpt-4o-mini-transcribe", "gpt-4o-mini-tts",
]);

const requestAccessSchema = z.object({
  capabilities: z.array(capability).max(8).default([]),
  deployments: z.array(deployment).min(1).max(8),
  projectName: z.string().trim().min(2).max(120),
  intendedUse: z.string().trim().min(10).max(2000),
  estimatedUsage: z.enum(["starter", "standard", "advanced", "custom"]).default("starter"),
  otherRequirements: z.string().trim().max(2000).default(""),
});

type AccessRequestRow = {
  id: string; capabilities: string[]; other_requirements: string; status: string;
  requested_deployments: string[]; project_name: string; intended_use: string; estimated_usage: string;
  review_notes: string; reviewed_at: string | null; created_at: string; updated_at: string;
};

async function listAccessRequests(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query<AccessRequestRow>(`
      SELECT id,capabilities,requested_deployments,project_name,intended_use,estimated_usage,
        other_requirements,status,review_notes,reviewed_at,created_at,updated_at
      FROM api_access_requests WHERE user_id = $1 ORDER BY created_at DESC
    `, [profile!.id]);
    const subscriptions = await query(`
      SELECT id, provider, product_name, key_last_four, status,
        quota_limit::float8 AS quota_limit, quota_unit,
        usage_count::float8 AS usage_count, expires_at,
        (encrypted_api_key IS NOT NULL) AS credential_available,
        credential_kind,allowed_deployments,
        created_at, rotated_at
      FROM api_subscriptions WHERE user_id = $1 ORDER BY created_at DESC
    `, [profile!.id]);
    const credential = await query(`
      SELECT id,key_last_four,status,(encrypted_api_key IS NOT NULL) credential_available,
        revealed_at,reveal_count,rotated_at,created_at
      FROM academy_credentials WHERE user_id=$1
    `,[profile!.id]);
    const origin=new URL(request.url).origin;
    return json(200, { data: {
      requests: result.rows,
      subscriptions: subscriptions.rows,
      credential:credential.rows[0]||null,
      gatewayBaseUrl:`${origin}/api/v1/gateway/openai/v1`,
      serviceGatewayBaseUrl:`${origin}/api/v1/gateway/azure/v1`,
    }, requestId });
  } catch (error) {
    context.error("List API access failed", error);
    return errorResponse(error, requestId);
  }
}

async function revealAcademyCredential(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  const requestId=context.invocationId;
  try{
    const profile=await ensureProfile(await requireAuth(request));
    const result=await query<{id:string;encrypted_api_key:string;status:string}>(`
      SELECT id,encrypted_api_key,status FROM academy_credentials WHERE user_id=$1
    `,[profile!.id]);
    const credential=result.rows[0];
    if(!credential)throw new HttpError(404,"Your Academy key has not been provisioned yet.");
    if(credential.status!=="active")throw new HttpError(409,"Your Academy key is not active.");
    const apiKey=decryptApiCredential(credential.encrypted_api_key);
    await query(`UPDATE academy_credentials SET revealed_at=now(),reveal_count=reveal_count+1,updated_at=now() WHERE id=$1`,[credential.id]);
    await query(`
      INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id)
      VALUES($1,'academy-credential.revealed','academy_credential',$2,$3)
    `,[profile!.id,credential.id,requestId]);
    return json(200,{data:{apiKey},requestId});
  }catch(error){
    context.error("Reveal Academy credential failed",error);
    return errorResponse(error,requestId);
  }
}

async function learnerUsage(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  const requestId=context.invocationId;
  try{
    const profile=await ensureProfile(await requireAuth(request));
    const subscription=await query(`SELECT id FROM api_subscriptions WHERE id=$1 AND user_id=$2`,[request.params.id,profile!.id]);
    if(!subscription.rowCount)throw new HttpError(404,"API subscription not found.");
    const [events,totals]=await Promise.all([
      query(`SELECT request_id,deployment,operation,quota_unit,units_charged::float8 units_charged,input_tokens::float8 input_tokens,output_tokens::float8 output_tokens,total_tokens::float8 total_tokens,status_code,latency_ms,created_at FROM api_usage_events WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 100`,[request.params.id]),
      query(`SELECT count(*)::int request_count,coalesce(sum(units_charged),0)::float8 charged_units,coalesce(sum(input_tokens),0)::float8 input_tokens,coalesce(sum(output_tokens),0)::float8 output_tokens,coalesce(sum(total_tokens),0)::float8 total_tokens FROM api_usage_events WHERE subscription_id=$1`,[request.params.id]),
    ]);
    return json(200,{data:{events:events.rows,totals:totals.rows[0]},requestId});
  }catch(error){return errorResponse(error,requestId);}
}

async function revealCredential(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query<{ encrypted_api_key: string | null; status: string; expires_at: string | null }>(`
      SELECT encrypted_api_key,status,expires_at FROM api_subscriptions
      WHERE id=$1 AND user_id=$2
    `, [request.params.id, profile!.id]);
    const subscription = result.rows[0];
    if (!subscription) throw new HttpError(404, "API credential not found.");
    if (subscription.status !== "active") throw new HttpError(409, "This API credential is no longer active.");
    if (subscription.expires_at && new Date(subscription.expires_at) <= new Date()) {
      await query(`UPDATE api_subscriptions SET status='expired' WHERE id=$1`, [request.params.id]);
      throw new HttpError(410, "This API credential has expired.");
    }
    if (!subscription.encrypted_api_key) throw new HttpError(409, "This older access record has not been provisioned with a usable credential yet.");
    const apiKey = decryptApiCredential(subscription.encrypted_api_key);
    await query(`
      UPDATE api_subscriptions SET revealed_at=now(),reveal_count=reveal_count+1 WHERE id=$1
    `, [request.params.id]);
    await query(`
      INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id)
      VALUES($1,'api-credential.revealed','api_subscription',$2,$3)
    `, [profile!.id, request.params.id, requestId]);
    return json(200, { data: { apiKey }, requestId });
  } catch (error) {
    context.error("Reveal API credential failed", error);
    return errorResponse(error, requestId);
  }
}

async function requestAccess(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const input = await parseJson(request, requestAccessSchema);
    const result = await query<AccessRequestRow>(`
      INSERT INTO api_access_requests
        (user_id,capabilities,requested_deployments,project_name,intended_use,estimated_usage,other_requirements)
      VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7)
      RETURNING id,capabilities,requested_deployments,project_name,intended_use,estimated_usage,
        other_requirements,status,review_notes,reviewed_at,created_at,updated_at
    `, [profile!.id, JSON.stringify(input.capabilities), JSON.stringify(input.deployments), input.projectName, input.intendedUse, input.estimatedUsage, input.otherRequirements]);
    await query(`INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id) VALUES ($1, 'api-access.requested', 'api_access_request', $2, $3)`, [profile!.id, result.rows[0]!.id, requestId]);
    return json(201, { data: result.rows[0], requestId });
  } catch (error) {
    context.error("Request API access failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("listApiAccess", { route: "v1/api-access", methods: ["GET"], authLevel: "anonymous", handler: listAccessRequests });
app.http("requestApiAccess", { route: "v1/api-access/requests", methods: ["POST"], authLevel: "anonymous", handler: requestAccess });
app.http("revealApiCredential", { route: "v1/api-access/subscriptions/{id:guid}/credential", methods: ["POST"], authLevel: "anonymous", handler: revealCredential });
app.http("revealAcademyCredential",{route:"v1/academy-credential/reveal",methods:["POST"],authLevel:"anonymous",handler:revealAcademyCredential});
app.http("learnerApiSubscriptionUsage",{route:"v1/api-access/subscriptions/{id:guid}/usage",methods:["GET"],authLevel:"anonymous",handler:learnerUsage});
