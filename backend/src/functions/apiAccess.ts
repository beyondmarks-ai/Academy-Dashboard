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

const requestAccessSchema = z.object({
  capabilities: z.array(capability).min(1).max(8),
  otherRequirements: z.string().trim().max(2000).default(""),
});

type AccessRequestRow = {
  id: string; capabilities: string[]; other_requirements: string; status: string;
  review_notes: string; reviewed_at: string | null; created_at: string; updated_at: string;
};

async function listAccessRequests(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query<AccessRequestRow>(`
      SELECT id, capabilities, other_requirements, status, review_notes, reviewed_at, created_at, updated_at
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
    return json(200, { data: { requests: result.rows, subscriptions: subscriptions.rows, gatewayBaseUrl:`${new URL(request.url).origin}/api/v1/gateway/openai/v1` }, requestId });
  } catch (error) {
    context.error("List API access failed", error);
    return errorResponse(error, requestId);
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
      INSERT INTO api_access_requests (user_id, capabilities, other_requirements)
      VALUES ($1, $2::jsonb, $3)
      RETURNING id, capabilities, other_requirements, status, review_notes, reviewed_at, created_at, updated_at
    `, [profile!.id, JSON.stringify(input.capabilities), input.otherRequirements]);
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
app.http("learnerApiSubscriptionUsage",{route:"v1/api-access/subscriptions/{id:guid}/usage",methods:["GET"],authLevel:"anonymous",handler:learnerUsage});
