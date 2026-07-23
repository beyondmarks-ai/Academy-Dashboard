import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { query } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";

const createInviteSchema = z.object({
  admissionId: z.string().trim().min(3).max(80),
  allowedAcademyId: z.string().trim().toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])?@beyondmarks\.ai$/, "A valid @beyondmarks.ai Academy ID is required.")
    .optional().or(z.literal("")),
  role: z.enum(["student", "admin", "developer"]).default("student"),
  expiresAt: z.string().datetime().optional().or(z.literal("")),
});

type InviteRow = {
  id: string;
  admission_id: string;
  allowed_academy_id: string | null;
  assigned_role: string;
  expires_at: string | null;
  created_at: string;
};

async function createAdmissionInvite(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const input = await parseJson(request, createInviteSchema);
    const result = await query<InviteRow>(`
      INSERT INTO admission_invites (admission_id, allowed_academy_id, expires_at, assigned_role)
      VALUES ($1, NULLIF($2, ''), NULLIF($3, '')::timestamptz, $4)
      ON CONFLICT (admission_id) DO UPDATE SET
        allowed_academy_id = EXCLUDED.allowed_academy_id,
        expires_at = EXCLUDED.expires_at,
        assigned_role = EXCLUDED.assigned_role
      WHERE admission_invites.claimed_by IS NULL
      RETURNING id, admission_id, allowed_academy_id, assigned_role, expires_at, created_at
    `, [input.admissionId, input.allowedAcademyId || "", input.expiresAt || "", input.role]);
    if (!result.rows[0]) {
      throw new HttpError(409, "This Admission ID has already been claimed.", "ADMISSION_ID_CLAIMED");
    }
    await query(`
      INSERT INTO audit_events (action, entity_type, entity_id, request_id, metadata)
      VALUES ('admission-invite.created', 'admission_invite', $1, $2, jsonb_build_object('allowedAcademyId', $3::text))
    `, [result.rows[0].id, requestId, result.rows[0].allowed_academy_id || ""]);
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
