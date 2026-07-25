import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import { query, transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    provider: z.string().trim().min(2).max(80),
    productName: z.string().trim().min(2).max(160),
    keyLastFour: z.string().trim().regex(/^[A-Za-z0-9]{4}$/, "Enter the final four API-key characters."),
    notes: z.string().trim().max(1000).default(""),
  }),
  z.object({
    decision: z.literal("reject"),
    notes: z.string().trim().min(3).max(1000),
  }),
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
        subscription.provider, subscription.product_name, subscription.key_last_four,
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
      if (accessRequest.status !== "pending") throw new HttpError(409, "This API access request has already been reviewed.");

      const status = input.decision === "approve" ? "approved" : "rejected";
      const updated = await client.query(`
        UPDATE api_access_requests
        SET status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now()
        WHERE id=$4 RETURNING *
      `, [status, input.notes, admin.profileId, accessRequest.id]);

      if (input.decision === "approve") {
        await client.query(`
          INSERT INTO api_subscriptions
            (user_id,access_request_id,provider,product_name,key_last_four,status)
          VALUES($1,$2,$3,$4,upper($5),'active')
          ON CONFLICT(access_request_id) WHERE access_request_id IS NOT NULL
          DO UPDATE SET provider=excluded.provider,product_name=excluded.product_name,
            key_last_four=excluded.key_last_four,status='active',rotated_at=now()
        `, [accessRequest.user_id, accessRequest.id, input.provider, input.productName, input.keyLastFour]);
      }

      const title = input.decision === "approve" ? "API access approved" : "API access request update";
      const message = input.decision === "approve"
        ? `Your ${input.productName} access request has been approved. Open Accessed API Keys to view the issued access record.${input.notes ? `\n\nAdministrator note: ${input.notes}` : ""}`
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
        JSON.stringify({ notes: input.notes, capabilities: accessRequest.capabilities }),
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
