import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth } from "../auth.js";
import { query } from "../db.js";
import { errorResponse, json, parseJson } from "../http.js";

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
      SELECT id, provider, product_name, key_last_four, status, created_at, rotated_at
      FROM api_subscriptions WHERE user_id = $1 ORDER BY created_at DESC
    `, [profile!.id]);
    return json(200, { data: { requests: result.rows, subscriptions: subscriptions.rows }, requestId });
  } catch (error) {
    context.error("List API access failed", error);
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
