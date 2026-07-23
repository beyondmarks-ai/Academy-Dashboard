import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth } from "../auth.js";
import { transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";

const onboardingSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Username contains unsupported characters."),
  admissionId: z.string().trim().min(3).max(80),
});

async function getMe(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const identity = await requireAuth(request);
    const profile = await ensureProfile(identity);
    return json(200, { data: profile, requestId });
  } catch (error) {
    context.error("Get profile failed", error);
    return errorResponse(error, requestId);
  }
}

async function completeOnboarding(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const identity = await requireAuth(request);
    const profile = await ensureProfile(identity);
    const input = await parseJson(request, onboardingSchema);

    const updated = await transaction(async (client) => {
      const invite = await client.query<{ id: string }>(`
        SELECT id FROM admission_invites
        WHERE admission_id = $1
          AND claimed_by IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND (allowed_email IS NULL OR lower(allowed_email) = lower($2))
        FOR UPDATE
      `, [input.admissionId, identity.email]);
      if (!invite.rows[0]) {
        throw new HttpError(403, "This Admission ID is invalid, expired, or already claimed.", "INVALID_ADMISSION_ID");
      }

      const result = await client.query(`
        UPDATE user_profiles
        SET full_name = $1, username = $2, admission_id = $3, status = 'active', updated_at = now()
        WHERE id = $4
        RETURNING *
      `, [input.fullName, input.username, input.admissionId, profile!.id]);
      await client.query(`
        UPDATE admission_invites SET claimed_by = $1, claimed_at = now() WHERE id = $2
      `, [profile!.id, invite.rows[0].id]);
      await client.query(`
        INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id)
        VALUES ($1, 'profile.onboarded', 'user_profile', $1, $2)
      `, [profile!.id, requestId]);
      return result.rows[0];
    });

    return json(200, { data: updated, requestId });
  } catch (error) {
    context.error("Complete onboarding failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("getMe", {
  route: "v1/me",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: getMe,
});

app.http("completeOnboarding", {
  route: "v1/me/onboarding",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: completeOnboarding,
});
