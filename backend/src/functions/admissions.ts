import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { query } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";

const createInviteSchema = z.object({
  admissionId: z.string().trim().min(3).max(80),
  allowedEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
  expiresAt: z.string().datetime().optional().or(z.literal("")),
});

type InviteRow = {
  id: string;
  admission_id: string;
  allowed_email: string | null;
  expires_at: string | null;
  created_at: string;
};

async function createAdmissionInvite(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const input = await parseJson(request, createInviteSchema);
    const result = await query<InviteRow>(`
      INSERT INTO admission_invites (admission_id, allowed_email, expires_at)
      VALUES ($1, NULLIF($2, ''), NULLIF($3, '')::timestamptz)
      ON CONFLICT (admission_id) DO UPDATE SET
        allowed_email = EXCLUDED.allowed_email,
        expires_at = EXCLUDED.expires_at
      WHERE admission_invites.claimed_by IS NULL
      RETURNING id, admission_id, allowed_email, expires_at, created_at
    `, [input.admissionId, input.allowedEmail || "", input.expiresAt || ""]);
    if (!result.rows[0]) {
      throw new HttpError(409, "This Admission ID has already been claimed.", "ADMISSION_ID_CLAIMED");
    }
    await query(`
      INSERT INTO audit_events (action, entity_type, entity_id, request_id, metadata)
      VALUES ('admission-invite.created', 'admission_invite', $1, $2, jsonb_build_object('allowedEmail', $3::text))
    `, [result.rows[0].id, requestId, result.rows[0].allowed_email || ""]);
    return json(201, { data: result.rows[0], requestId });
  } catch (error) {
    context.error("Create admission invitation failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("createAdmissionInvite", {
  route: "internal/admission-invites",
  methods: ["POST"],
  authLevel: "function",
  handler: createAdmissionInvite,
});
