import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import { query, transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { encryptApiCredential } from "../credentialCrypto.js";
import { hashOpaqueToken } from "../security.js";

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    productName: z.string().trim().min(2).max(160),
    allowedDeployments: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    quotaLimit: z.number().int().positive().max(9_000_000_000_000_000),
    quotaUnit: z.enum(["requests","tokens","images","minutes","seconds"]),
    expiresAt: z.string().datetime().refine((value) => new Date(value).getTime() > Date.now(), "Credential expiry must be in the future."),
    notes: z.string().trim().max(1000).default(""),
  }),
  z.object({
    decision: z.literal("reject"),
    notes: z.string().trim().min(3).max(1000),
  }),
]);
const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({ action:z.literal("topUp"), amount:z.number().int().positive().max(9_000_000_000_000_000), notes:z.string().trim().max(500).default("") }),
  z.object({ action:z.literal("reset"), notes:z.string().trim().max(500).default("") }),
  z.object({ action:z.literal("renew"), quotaLimit:z.number().int().positive().max(9_000_000_000_000_000), quotaUnit:z.enum(["requests","tokens","images","minutes","seconds"]), expiresAt:z.string().datetime().refine(value=>new Date(value).getTime()>Date.now(),"Renewal expiry must be in the future."), notes:z.string().trim().max(500).default("") }),
  z.object({ action:z.literal("revoke"), notes:z.string().trim().max(500).default("") }),
]);

async function requireAdmin(request: HttpRequest) {
  const user = await requireAuth(request);
  requireRole(user, "Admin");
  return user;
}

async function listApiRequests(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request);
    const result = await query(`
      SELECT request.id, request.user_id, request.capabilities, request.other_requirements,
        request.status, request.review_notes, request.reviewed_at, request.created_at, request.updated_at,
        profile.full_name, profile.academy_id, profile.admission_id, profile.admission_number,
        subscription.id AS subscription_id, subscription.provider, subscription.product_name,
        subscription.key_last_four, subscription.quota_limit::float8 AS quota_limit, subscription.quota_unit,
        subscription.usage_count::float8 AS usage_count, subscription.expires_at,
        subscription.credential_kind, subscription.allowed_deployments,
        subscription.status AS subscription_status
      FROM api_access_requests request
      JOIN user_profiles profile ON profile.id=request.user_id
      LEFT JOIN api_subscriptions subscription ON subscription.access_request_id=request.id
      ORDER BY CASE request.status WHEN 'pending' THEN 0 ELSE 1 END, request.created_at DESC
      LIMIT 500
    `);
    return json(200, { data: result.rows, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function manageSubscription(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const administrator=await requireAdmin(request);
    const input=await parseJson(request,lifecycleSchema);
    const data=await transaction(async client=>{
      const found=await client.query<{id:string;quota_limit:number|null;quota_unit:string;usage_count:number;status:string}>(`
        SELECT id,quota_limit,quota_unit,usage_count,status FROM api_subscriptions WHERE id=$1 FOR UPDATE
      `,[request.params.id]);
      const subscription=found.rows[0];
      if(!subscription)throw new HttpError(404,"API subscription not found.");
      if(input.action==="revoke"){
        const updated=await client.query(`UPDATE api_subscriptions SET status='revoked' WHERE id=$1 RETURNING *`,[subscription.id]);
        await client.query(`DELETE FROM api_gateway_reservations WHERE subscription_id=$1`,[subscription.id]);
        return updated.rows[0];
      }
      if(input.action==="topUp"){
        if(subscription.status!=="active")throw new HttpError(409,"Only active access can be topped up.");
        const updated=await client.query(`UPDATE api_subscriptions SET quota_limit=coalesce(quota_limit,0)+$1 WHERE id=$2 RETURNING *`,[input.amount,subscription.id]);
        await client.query(`INSERT INTO api_quota_allocations(subscription_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'top_up',$3,$4,$5,$6,$7,$8)`,[subscription.id,administrator.profileId,input.amount,subscription.quota_unit,subscription.quota_limit,subscription.usage_count,updated.rows[0].expires_at,input.notes]);
        return updated.rows[0];
      }
      if(input.action==="reset"){
        if(!subscription.quota_limit)throw new HttpError(409,"Set a quota before resetting usage.");
        const updated=await client.query(`UPDATE api_subscriptions SET usage_count=0,status='active' WHERE id=$1 RETURNING *`,[subscription.id]);
        await client.query(`DELETE FROM api_gateway_reservations WHERE subscription_id=$1`,[subscription.id]);
        await client.query(`INSERT INTO api_quota_allocations(subscription_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'reset',$3,$4,$5,$6,$7,$8)`,[subscription.id,administrator.profileId,subscription.quota_limit,subscription.quota_unit,subscription.quota_limit,subscription.usage_count,updated.rows[0].expires_at,input.notes]);
        return updated.rows[0];
      }
      const updated=await client.query(`UPDATE api_subscriptions SET quota_limit=$1,quota_unit=$2,usage_count=0,expires_at=$3,status='active' WHERE id=$4 RETURNING *`,[input.quotaLimit,input.quotaUnit,input.expiresAt,subscription.id]);
      await client.query(`DELETE FROM api_gateway_reservations WHERE subscription_id=$1`,[subscription.id]);
      await client.query(`INSERT INTO api_quota_allocations(subscription_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'renew',$3,$4,$5,$6,$7,$8)`,[subscription.id,administrator.profileId,input.quotaLimit,input.quotaUnit,subscription.quota_limit,subscription.usage_count,input.expiresAt,input.notes]);
      return updated.rows[0];
    });
    await query(`INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id,metadata) VALUES($1,$2,'api_subscription',$3,$4,$5::jsonb)`,[administrator.profileId,`api-subscription.${input.action}`,request.params.id,context.invocationId,JSON.stringify(input)]);
    return json(200,{data,requestId:context.invocationId});
  }catch(error){return errorResponse(error,context.invocationId);}
}

async function subscriptionUsage(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try{
    await requireAdmin(request);
    const subscription=await query(`
      SELECT id,quota_limit::float8 quota_limit,quota_unit,usage_count::float8 usage_count,
        greatest(coalesce(quota_limit,0)-usage_count,0)::float8 remaining,status,expires_at
      FROM api_subscriptions WHERE id=$1
    `,[request.params.id]);
    if(!subscription.rowCount)throw new HttpError(404,"API subscription not found.");
    const [events,allocations,totals]=await Promise.all([
      query(`SELECT id,request_id,deployment,operation,quota_unit,units_charged::float8 units_charged,input_tokens::float8 input_tokens,output_tokens::float8 output_tokens,total_tokens::float8 total_tokens,status_code,latency_ms,upstream_request_id,created_at FROM api_usage_events WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 250`,[request.params.id]),
      query(`SELECT id,action,amount::float8 amount,quota_unit,previous_limit::float8 previous_limit,previous_usage::float8 previous_usage,expires_at,notes,created_at FROM api_quota_allocations WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 100`,[request.params.id]),
      query(`SELECT count(*)::int request_count,coalesce(sum(units_charged),0)::float8 charged_units,coalesce(sum(input_tokens),0)::float8 input_tokens,coalesce(sum(output_tokens),0)::float8 output_tokens,coalesce(sum(total_tokens),0)::float8 total_tokens FROM api_usage_events WHERE subscription_id=$1`,[request.params.id]),
    ]);
    return json(200,{data:{subscription:subscription.rows[0],events:events.rows,allocations:allocations.rows,totals:totals.rows[0]},requestId:context.invocationId});
  }catch(error){return errorResponse(error,context.invocationId);}
}

async function reviewApiRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const admin = await requireAdmin(request);
    const input = await parseJson(request, reviewSchema);
    const reviewed = await transaction(async (client) => {
      const existing = await client.query<{
        id: string; user_id: string; status: string; capabilities: string[];
      }>(`SELECT id,user_id,status,capabilities FROM api_access_requests WHERE id=$1 FOR UPDATE`, [request.params.id]);
      const accessRequest = existing.rows[0];
      if (!accessRequest) throw new HttpError(404, "API access request not found.");
      if (input.decision === "reject" && accessRequest.status !== "pending") throw new HttpError(409, "Only pending API access requests can be rejected.");
      if (input.decision === "approve" && !["pending", "approved"].includes(accessRequest.status)) throw new HttpError(409, "This API access request cannot be provisioned.");

      const status = input.decision === "approve" ? "approved" : "rejected";
      const updated = await client.query(`
        UPDATE api_access_requests
        SET status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now()
        WHERE id=$4 RETURNING *
      `, [status, input.notes, admin.profileId, accessRequest.id]);

      if (input.decision === "approve") {
        const academyKey = `bm_live_${randomBytes(28).toString("base64url")}`;
        const previous = await client.query<{ id:string; quota_limit:number|null; usage_count:number }>(`
          SELECT id,quota_limit,usage_count FROM api_subscriptions WHERE access_request_id=$1
        `,[accessRequest.id]);
        const issued = await client.query<{id:string}>(`
          INSERT INTO api_subscriptions
            (user_id,access_request_id,provider,product_name,key_last_four,encrypted_api_key,
             credential_hash,credential_kind,allowed_deployments,
             quota_limit,quota_unit,expires_at,status)
          VALUES($1,$2,'Beyond Marks AI Academy',$3,upper(right($4,4)),$5,$6,'academy_gateway',$7::jsonb,$8,$9,$10,'active')
          ON CONFLICT(access_request_id) WHERE access_request_id IS NOT NULL
          DO UPDATE SET provider='Beyond Marks AI Academy',product_name=excluded.product_name,
            key_last_four=excluded.key_last_four,encrypted_api_key=excluded.encrypted_api_key,
            credential_hash=excluded.credential_hash,credential_kind='academy_gateway',
            allowed_deployments=excluded.allowed_deployments,
            quota_limit=excluded.quota_limit,quota_unit=excluded.quota_unit,
            usage_count=0,expires_at=excluded.expires_at,status='active',rotated_at=now()
          RETURNING id
        `, [accessRequest.user_id, accessRequest.id, input.productName, academyKey, encryptApiCredential(academyKey), hashOpaqueToken(academyKey), JSON.stringify(input.allowedDeployments), input.quotaLimit, input.quotaUnit, input.expiresAt]);
        await client.query(`
          INSERT INTO api_quota_allocations(subscription_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,[issued.rows[0]!.id,admin.profileId,previous.rowCount?"renew":"initial",input.quotaLimit,input.quotaUnit,previous.rows[0]?.quota_limit||null,previous.rows[0]?.usage_count||0,input.expiresAt,input.notes]);
      }

      const title = input.decision === "approve" ? "API access approved" : "API access request update";
      const message = input.decision === "approve"
        ? `Your ${input.productName} access request has been approved. Open Manage API key to reveal your Academy-managed key and copy the ready-to-use environment variables.${input.notes ? `\n\nAdministrator note: ${input.notes}` : ""}`
        : `Your API access request was not approved.${input.notes ? `\n\nReason: ${input.notes}` : ""}`;
      const campaign = await client.query<{ id: string }>(`
        INSERT INTO notification_campaigns(title,message,category,priority,created_by)
        VALUES($1,$2,'API access',$3,$4) RETURNING id
      `, [title, message, input.decision === "approve" ? "important" : "urgent", admin.profileId]);
      await client.query(
        `INSERT INTO notification_recipients(campaign_id,user_id) VALUES($1,$2)`,
        [campaign.rows[0]!.id, accessRequest.user_id],
      );
      await client.query(`
        INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id,metadata)
        VALUES($1,$2,'api_access_request',$3,$4,$5::jsonb)
      `, [
        admin.profileId,
        `api-access.${status}`,
        accessRequest.id,
        context.invocationId,
        JSON.stringify({
          notes: input.notes,
          capabilities: accessRequest.capabilities,
          ...(input.decision === "approve" ? { quotaLimit: input.quotaLimit, quotaUnit: input.quotaUnit, expiresAt: input.expiresAt, allowedDeployments: input.allowedDeployments } : {}),
        }),
      ]);
      return updated.rows[0];
    });
    return json(200, { data: reviewed, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

app.http("adminListApiAccessRequests", {
  route: "v1/admin/api-access/requests",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listApiRequests,
});
app.http("adminReviewApiAccessRequest", {
  route: "v1/admin/api-access/requests/{id:guid}/review",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: reviewApiRequest,
});
app.http("adminManageApiSubscription",{route:"v1/admin/api-access/subscriptions/{id:guid}",methods:["POST"],authLevel:"anonymous",handler:manageSubscription});
app.http("adminApiSubscriptionUsage",{route:"v1/admin/api-access/subscriptions/{id:guid}/usage",methods:["GET"],authLevel:"anonymous",handler:subscriptionUsage});
