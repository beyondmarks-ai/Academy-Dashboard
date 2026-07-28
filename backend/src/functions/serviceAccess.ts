import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth, requireRole } from "../auth.js";
import { query, transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { ensureAcademyCredential,upsertCredentialScope } from "../academyCredentials.js";
import { enqueueServiceProvisioning } from "../serviceProvisioningQueue.js";

const serviceType = z.enum([
  "blob_storage", "container_compute", "machine_learning", "database", "functions",
  "document_intelligence", "speech_vision", "messaging", "monitoring",
]);
const quotaUnit = z.enum([
  "bytes", "compute_minutes", "gpu_minutes", "database_mb", "executions",
  "requests", "pages", "minutes", "messages", "events", "log_mb",
]);
const serviceUnits: Record<z.infer<typeof serviceType>, z.infer<typeof quotaUnit>> = {
  blob_storage: "bytes",
  container_compute: "compute_minutes",
  machine_learning: "gpu_minutes",
  database: "database_mb",
  functions: "executions",
  document_intelligence: "pages",
  speech_vision: "minutes",
  messaging: "messages",
  monitoring: "log_mb",
};

const requestSchema = z.object({
  serviceType,
  projectName: z.string().trim().min(2).max(120),
  planCode: z.enum(["explore", "build", "scale", "custom"]),
  requestedQuota: z.number().int().positive().max(9_000_000_000_000_000),
  requestedUnit: quotaUnit,
  useCase: z.string().trim().min(10).max(3000),
  configuration: z.record(z.string(), z.unknown()).default({}),
});
const reviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    displayName: z.string().trim().min(2).max(160),
    quotaLimit: z.number().int().positive().max(9_000_000_000_000_000),
    quotaUnit,
    expiresAt: z.string().datetime().refine(value => new Date(value).getTime() > Date.now(), "Expiry must be in the future."),
    resourceConfig: z.record(z.string(), z.unknown()).default({}),
    notes: z.string().trim().max(1000).default(""),
  }),
  z.object({ decision: z.literal("reject"), notes: z.string().trim().min(3).max(1000) }),
]);
const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("topUp"), amount: z.number().int().positive().max(9_000_000_000_000_000), notes: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("reset"), notes: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("renew"), quotaLimit: z.number().int().positive().max(9_000_000_000_000_000), expiresAt: z.string().datetime(), notes: z.string().trim().max(500).default("") }),
  z.object({ action: z.enum(["suspend", "activate", "revoke"]), notes: z.string().trim().max(500).default("") }),
]);
const usageSchema = z.object({
  entitlementId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  operation: z.string().trim().min(2).max(160),
  quantity: z.number().int().positive().max(9_000_000_000_000_000),
  resourceId: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

async function requireAdmin(request: HttpRequest) {
  const user = await requireAuth(request);
  requireRole(user, "Admin");
  return user;
}

async function notify(client: import("pg").PoolClient, input: { userId: string; actorId: string; title: string; message: string; priority?: "normal" | "important" | "urgent" }) {
  const campaign = await client.query<{ id: string }>(`
    INSERT INTO notification_campaigns(title,message,category,priority,created_by)
    VALUES($1,$2,'Azure services',$3,$4) RETURNING id
  `, [input.title, input.message, input.priority || "important", input.actorId]);
  await client.query(`INSERT INTO notification_recipients(campaign_id,user_id) VALUES($1,$2)`, [campaign.rows[0]!.id, input.userId]);
}

async function listLearnerAccess(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const profile = await ensureProfile(await requireAuth(request));
    await query(`UPDATE service_entitlements SET status='expired',updated_at=now() WHERE user_id=$1 AND status='active' AND expires_at<=now()`, [profile!.id]);
    const [requests, entitlements, events, allocations] = await Promise.all([
      query(`SELECT id,service_type,project_name,plan_code,requested_quota::float8 requested_quota,requested_unit,use_case,configuration,status,review_notes,reviewed_at,created_at,updated_at FROM service_access_requests WHERE user_id=$1 ORDER BY created_at DESC`, [profile!.id]),
      query(`SELECT id,request_id,service_type,display_name,quota_limit::float8 quota_limit,quota_unit,usage_count::float8 usage_count,status,resource_config,expires_at,created_at,updated_at FROM service_entitlements WHERE user_id=$1 ORDER BY created_at DESC`, [profile!.id]),
      query(`SELECT event.id,event.entitlement_id,entitlement.service_type,event.operation,event.quantity::float8 quantity,event.quota_unit,event.status,event.resource_id,event.metadata,event.occurred_at FROM service_usage_events event JOIN service_entitlements entitlement ON entitlement.id=event.entitlement_id WHERE event.user_id=$1 ORDER BY event.occurred_at DESC LIMIT 150`, [profile!.id]),
      query(`SELECT allocation.id,allocation.entitlement_id,entitlement.service_type,allocation.action,allocation.amount::float8 amount,allocation.quota_unit,allocation.previous_limit::float8 previous_limit,allocation.previous_usage::float8 previous_usage,allocation.expires_at,allocation.notes,allocation.created_at FROM service_quota_allocations allocation JOIN service_entitlements entitlement ON entitlement.id=allocation.entitlement_id WHERE entitlement.user_id=$1 ORDER BY allocation.created_at DESC LIMIT 150`, [profile!.id]),
    ]);
    return json(200, { data: { requests: requests.rows, entitlements: entitlements.rows, ledger: { events: events.rows, allocations: allocations.rows } }, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function createRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const input = await parseJson(request, requestSchema);
    if (serviceUnits[input.serviceType] !== input.requestedUnit) throw new HttpError(422, "The requested allowance unit does not match this Azure service.");
    const active = await query(`SELECT id FROM service_entitlements WHERE user_id=$1 AND service_type=$2 AND status='active'`, [profile!.id, input.serviceType]);
    if (active.rowCount) throw new HttpError(409, "You already have active access to this service. Ask the administrator to renew or increase its allowance.");
    const result = await query(`
      INSERT INTO service_access_requests(user_id,service_type,project_name,plan_code,requested_quota,requested_unit,use_case,configuration)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING id,service_type,project_name,plan_code,requested_quota::float8 requested_quota,requested_unit,use_case,configuration,status,review_notes,reviewed_at,created_at,updated_at
    `, [profile!.id, input.serviceType, input.projectName, input.planCode, input.requestedQuota, input.requestedUnit, input.useCase, JSON.stringify(input.configuration)]);
    await query(`INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id,metadata) VALUES($1,'service-access.requested','service_access_request',$2,$3,$4::jsonb)`, [profile!.id, result.rows[0]!.id, context.invocationId, JSON.stringify({ serviceType: input.serviceType, planCode: input.planCode })]);
    return json(201, { data: result.rows[0], requestId: context.invocationId });
  } catch (error) {
    const mapped = (error as { code?: string }).code === "23505" ? new HttpError(409, "A pending request for this service already exists.") : error;
    return errorResponse(mapped, context.invocationId);
  }
}

async function listAdminRequests(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request);
    const result = await query(`
      SELECT access.*,access.requested_quota::float8 requested_quota,
        profile.full_name,profile.academy_id,profile.admission_number,
        entitlement.id entitlement_id,entitlement.display_name,entitlement.quota_limit::float8 quota_limit,
        entitlement.quota_unit,entitlement.usage_count::float8 usage_count,
        entitlement.status entitlement_status,entitlement.resource_config,entitlement.expires_at
      FROM service_access_requests access
      JOIN user_profiles profile ON profile.id=access.user_id
      LEFT JOIN service_entitlements entitlement ON entitlement.request_id=access.id
      ORDER BY CASE access.status WHEN 'pending' THEN 0 ELSE 1 END,access.created_at DESC
      LIMIT 500
    `);
    return json(200, { data: result.rows, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function reviewRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const administrator = await requireAdmin(request);
    const input = await parseJson(request, reviewSchema);
    const jobKey=`provision:${request.params.id}:${Date.now()}`;
    const result = await transaction(async client => {
      const found = await client.query<{ id: string; user_id: string; service_type: string; status: string; project_name: string }>(`SELECT id,user_id,service_type,status,project_name FROM service_access_requests WHERE id=$1 FOR UPDATE`, [request.params.id]);
      const access = found.rows[0];
      if (!access) throw new HttpError(404, "Azure service request not found.");
      if (input.decision === "reject" && access.status !== "pending") throw new HttpError(409, "Only pending requests can be rejected.");
      if (input.decision === "approve" && !["pending", "approved"].includes(access.status)) throw new HttpError(409, "This request cannot be provisioned.");
      if (input.decision === "approve" && input.quotaUnit !== serviceUnits[access.service_type as keyof typeof serviceUnits]) {
        throw new HttpError(422, "The allowance unit must match the selected Azure service.");
      }
      const updated = await client.query(`UPDATE service_access_requests SET status=$1,review_notes=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() WHERE id=$4 RETURNING *`, [input.decision === "approve" ? "approved" : "rejected", input.notes, administrator.profileId, access.id]);
      let jobId:string|null=null;
      if (input.decision === "approve") {
        if(["container_compute","functions","machine_learning"].includes(access.service_type)){
          const requested=(input.resourceConfig.requestedConfiguration&&typeof input.resourceConfig.requestedConfiguration==="object"
            ?input.resourceConfig.requestedConfiguration:{}) as Record<string,unknown>;
          const githubRepository=typeof requested.githubRepository==="string"?requested.githubRepository.trim():"";
          const containerImage=typeof requested.containerImage==="string"?requested.containerImage.trim():"";
          if(!githubRepository&&!containerImage)throw new HttpError(422,"Approve compute, Functions, and ML only with a reviewed GitHub repository or container image.");
          if(githubRepository&&!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(githubRepository))throw new HttpError(422,"The approved repository must be a complete github.com repository URL.");
          if(containerImage&&!/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})?$/i.test(containerImage))throw new HttpError(422,"The approved container image reference is invalid.");
        }
        const credential=await ensureAcademyCredential(client,access.user_id);
        const previous = await client.query<{ id: string; quota_limit: number; usage_count: number }>(`SELECT id,quota_limit,usage_count FROM service_entitlements WHERE request_id=$1`, [access.id]);
        const entitlement = await client.query<{ id: string }>(`
          INSERT INTO service_entitlements(request_id,user_id,service_type,display_name,quota_limit,quota_unit,resource_config,expires_at,status,credential_id)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'provisioning',$9)
          ON CONFLICT(request_id) DO UPDATE SET display_name=excluded.display_name,quota_limit=excluded.quota_limit,
            quota_unit=excluded.quota_unit,usage_count=0,resource_config=excluded.resource_config,
            expires_at=excluded.expires_at,status='provisioning',credential_id=excluded.credential_id,updated_at=now()
          RETURNING id
        `, [access.id, access.user_id, access.service_type, input.displayName, input.quotaLimit, input.quotaUnit, JSON.stringify(input.resourceConfig), input.expiresAt,credential.id]);
        await upsertCredentialScope(client,{credentialId:credential.id,scopeType:"service",scopeKey:access.service_type,sourceId:entitlement.rows[0]!.id,status:"provisioning",expiresAt:input.expiresAt});
        const job=await client.query<{id:string}>(`
          INSERT INTO service_provisioning_jobs(entitlement_id,operation,status,idempotency_key)
          VALUES($1,'provision','queued',$2) RETURNING id
        `,[entitlement.rows[0]!.id,jobKey]);
        jobId=job.rows[0]!.id;
        await client.query(`INSERT INTO service_quota_allocations(entitlement_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [entitlement.rows[0]!.id, administrator.profileId, previous.rowCount ? "renew" : "initial", input.quotaLimit, input.quotaUnit, previous.rows[0]?.quota_limit || null, previous.rows[0]?.usage_count || 0, input.expiresAt, input.notes]);
      }
      await notify(client, {
        userId: access.user_id,
        actorId: administrator.profileId,
        title: input.decision === "approve" ? "Azure service access approved" : "Azure service request update",
        message: input.decision === "approve"
          ? `${input.displayName} has been approved for ${access.project_name} and is now being provisioned. Your existing Academy key will work as soon as the status becomes active.${input.notes ? `\n\nAdministrator note: ${input.notes}` : ""}`
          : `Your ${access.service_type.replaceAll("_", " ")} request was not approved.${input.notes ? `\n\nReason: ${input.notes}` : ""}`,
      });
      return {data:updated.rows[0],jobId};
    });
    if(result.jobId){
      try{await enqueueServiceProvisioning(result.jobId);}
      catch(error){
        await query(`UPDATE service_provisioning_jobs SET status='failed',error_code='QUEUE_UNAVAILABLE',error_message=$1,updated_at=now() WHERE id=$2`,[error instanceof Error?error.message:"Queue unavailable",result.jobId]);
        throw new HttpError(503,"Access was approved, but provisioning could not be queued. Use Retry provisioning.");
      }
    }
    await query(`INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id,metadata) VALUES($1,$2,'service_access_request',$3,$4,$5::jsonb)`, [administrator.profileId, `service-access.${input.decision}`, request.params.id, context.invocationId, JSON.stringify(input)]);
    return json(result.jobId?202:200, { data:result.data, provisioningJobId:result.jobId, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function manageEntitlement(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const administrator = await requireAdmin(request);
    const input = await parseJson(request, lifecycleSchema);
    const data = await transaction(async client => {
      const found = await client.query<{ id: string; user_id: string; display_name: string; quota_limit: number; quota_unit: string; usage_count: number; expires_at: string | null; status: string }>(`SELECT id,user_id,display_name,quota_limit,quota_unit,usage_count,expires_at,status FROM service_entitlements WHERE id=$1 FOR UPDATE`, [request.params.id]);
      const item = found.rows[0];
      if (!item) throw new HttpError(404, "Service entitlement not found.");
      if (input.action === "suspend" || input.action === "activate" || input.action === "revoke") {
        if (input.action === "activate" && item.expires_at && new Date(item.expires_at) <= new Date()) throw new HttpError(409, "Renew this expired entitlement before activating it.");
        const updated = await client.query(`UPDATE service_entitlements SET status=$1,updated_at=now() WHERE id=$2 RETURNING *`, [input.action === "suspend" ? "suspended" : input.action === "revoke" ? "revoked" : "active", item.id]);
        await client.query(`UPDATE academy_credential_scopes SET status=$1,updated_at=now() WHERE source_id=$2 AND scope_type='service'`,[updated.rows[0].status,item.id]);
        const lifecycleTitle = input.action === "suspend" ? "Azure service suspended" : input.action === "activate" ? "Azure service activated" : "Azure service revoked";
        await notify(client, { userId: item.user_id, actorId: administrator.profileId, title: lifecycleTitle, message: `${item.display_name} is now ${updated.rows[0].status}.${input.notes ? `\n\nAdministrator note: ${input.notes}` : ""}` });
        return updated.rows[0];
      }
      if (input.action === "topUp") {
        if (item.status !== "active") throw new HttpError(409, "Only active service access can be topped up.");
        const updated = await client.query(`UPDATE service_entitlements SET quota_limit=quota_limit+$1,updated_at=now() WHERE id=$2 RETURNING *`, [input.amount, item.id]);
        await client.query(`INSERT INTO service_quota_allocations(entitlement_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'top_up',$3,$4,$5,$6,$7,$8)`, [item.id, administrator.profileId, input.amount, item.quota_unit, item.quota_limit, item.usage_count, item.expires_at, input.notes]);
        return updated.rows[0];
      }
      if (input.action === "reset") {
        const updated = await client.query(`UPDATE service_entitlements SET usage_count=0,status='active',updated_at=now() WHERE id=$1 RETURNING *`, [item.id]);
        await client.query(`UPDATE academy_credential_scopes SET status='active',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[item.id]);
        await client.query(`INSERT INTO service_quota_allocations(entitlement_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'reset',$3,$4,$5,$6,$7,$8)`, [item.id, administrator.profileId, item.quota_limit, item.quota_unit, item.quota_limit, item.usage_count, item.expires_at, input.notes]);
        return updated.rows[0];
      }
      if (input.action !== "renew") throw new HttpError(422, "Unsupported service entitlement action.");
      const updated = await client.query(`UPDATE service_entitlements SET quota_limit=$1,usage_count=0,expires_at=$2,status='active',updated_at=now() WHERE id=$3 RETURNING *`, [input.quotaLimit, input.expiresAt, item.id]);
      await client.query(`UPDATE academy_credential_scopes SET status='active',expires_at=$1,updated_at=now() WHERE source_id=$2 AND scope_type='service'`,[input.expiresAt,item.id]);
      await client.query(`INSERT INTO service_quota_allocations(entitlement_id,actor_id,action,amount,quota_unit,previous_limit,previous_usage,expires_at,notes) VALUES($1,$2,'renew',$3,$4,$5,$6,$7,$8)`, [item.id, administrator.profileId, input.quotaLimit, item.quota_unit, item.quota_limit, item.usage_count, input.expiresAt, input.notes]);
      return updated.rows[0];
    });
    await query(`INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id,metadata) VALUES($1,$2,'service_entitlement',$3,$4,$5::jsonb)`, [administrator.profileId, `service-entitlement.${input.action}`, request.params.id, context.invocationId, JSON.stringify(input)]);
    return json(200, { data, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function retryProvisioning(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  try{
    const administrator=await requireAdmin(request);
    const jobKey=`retry:${request.params.id}:${Date.now()}`;
    const job=await transaction(async client=>{
      const entitlement=await client.query<{id:string;credential_id:string|null;status:string}>(`SELECT id,credential_id,status FROM service_entitlements WHERE id=$1 FOR UPDATE`,[request.params.id]);
      const item=entitlement.rows[0];
      if(!item)throw new HttpError(404,"Service entitlement not found.");
      if(!["failed","provisioning"].includes(item.status))throw new HttpError(409,"Only failed or stalled provisioning can be retried.");
      await client.query(`UPDATE service_entitlements SET status='provisioning',updated_at=now() WHERE id=$1`,[item.id]);
      await client.query(`UPDATE academy_credential_scopes SET status='provisioning',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[item.id]);
      const created=await client.query<{id:string}>(`INSERT INTO service_provisioning_jobs(entitlement_id,operation,status,idempotency_key) VALUES($1,'provision','queued',$2) RETURNING id`,[item.id,jobKey]);
      await client.query(`INSERT INTO audit_events(actor_id,action,entity_type,entity_id,request_id) VALUES($1,'service-entitlement.provision-retry','service_entitlement',$2,$3)`,[administrator.profileId,item.id,context.invocationId]);
      return created.rows[0]!;
    });
    await enqueueServiceProvisioning(job.id);
    return json(202,{data:{jobId:job.id,status:"queued"},requestId:context.invocationId});
  }catch(error){return errorResponse(error,context.invocationId);}
}

async function recordUsage(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const input = await parseJson(request, usageSchema);
    const data = await transaction(async client => {
      const existing = await client.query(`SELECT * FROM service_usage_events WHERE idempotency_key=$1`, [input.idempotencyKey]);
      if (existing.rowCount) return existing.rows[0];
      const found = await client.query<{ id: string; user_id: string; quota_limit: number; quota_unit: string; usage_count: number; status: string; expires_at: string | null }>(`SELECT id,user_id,quota_limit,quota_unit,usage_count,status,expires_at FROM service_entitlements WHERE id=$1 FOR UPDATE`, [input.entitlementId]);
      const item = found.rows[0];
      if (!item) throw new HttpError(404, "Service entitlement not found.");
      if (item.status !== "active" || (item.expires_at && new Date(item.expires_at) <= new Date())) throw new HttpError(403, "Service entitlement is not active.");
      if (item.usage_count + input.quantity > item.quota_limit) throw new HttpError(403, `Allowance exceeded. ${Math.max(0, item.quota_limit - item.usage_count).toLocaleString()} ${item.quota_unit} remain.`);
      await client.query(`UPDATE service_entitlements SET usage_count=usage_count+$1,updated_at=now() WHERE id=$2`, [input.quantity, item.id]);
      const event = await client.query(`INSERT INTO service_usage_events(entitlement_id,user_id,idempotency_key,operation,quantity,quota_unit,resource_id,metadata,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9::timestamptz,now())) RETURNING *`, [item.id, item.user_id, input.idempotencyKey, input.operation, input.quantity, item.quota_unit, input.resourceId || null, JSON.stringify(input.metadata), input.occurredAt || null]);
      return event.rows[0];
    });
    return json(201, { data, requestId: context.invocationId });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

app.http("learnerServiceAccess", { route: "v1/service-access", methods: ["GET"], authLevel: "anonymous", handler: listLearnerAccess });
app.http("learnerRequestServiceAccess", { route: "v1/service-access/requests", methods: ["POST"], authLevel: "anonymous", handler: createRequest });
app.http("adminListServiceAccessRequests", { route: "v1/admin/service-access/requests", methods: ["GET"], authLevel: "anonymous", handler: listAdminRequests });
app.http("adminReviewServiceAccessRequest", { route: "v1/admin/service-access/requests/{id:guid}/review", methods: ["POST"], authLevel: "anonymous", handler: reviewRequest });
app.http("adminManageServiceEntitlement", { route: "v1/admin/service-access/entitlements/{id:guid}", methods: ["POST"], authLevel: "anonymous", handler: manageEntitlement });
app.http("adminRetryServiceProvisioning",{route:"v1/admin/service-access/entitlements/{id:guid}/provision",methods:["POST"],authLevel:"anonymous",handler:retryProvisioning});
app.http("recordServiceUsage", { route: "internal/service-usage", methods: ["POST"], authLevel: "function", handler: recordUsage });
