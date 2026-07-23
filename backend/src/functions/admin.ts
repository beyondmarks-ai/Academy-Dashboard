import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth, requireRole } from "../auth.js";
import { query, transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { hashPassword, normalizeAcademyId } from "../security.js";

const invitationSchema = z.object({
  admissionId: z.string().trim().min(3).max(80),
  allowedAcademyId: z.string().trim().max(80).optional().default(""),
  role: z.enum(["student", "developer"]).default("student"),
  expiresAt: z.string().datetime().optional().or(z.literal("")),
});

const statusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

const resetPasswordSchema = z.object({
  password: z.string()
    .min(12, "Password must contain at least 12 characters.")
    .max(128)
    .regex(/[a-z]/, "Password must contain a lowercase letter.")
    .regex(/[A-Z]/, "Password must contain an uppercase letter.")
    .regex(/[0-9]/, "Password must contain a number."),
});

async function requireAdmin(request: HttpRequest) {
  const identity = await requireAuth(request);
  requireRole(identity, "Admin");
  return ensureProfile(identity);
}

async function listStudents(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    await requireAdmin(request);
    const search = (request.query.get("search") || "").trim().slice(0, 80);
    const result = await query(`
      SELECT p.id, p.academy_id, p.username, p.full_name, p.admission_id, p.role, p.status,
             p.created_at, MAX(s.last_seen_at) AS last_seen_at
      FROM user_profiles p
      LEFT JOIN auth_sessions s ON s.user_id = p.id
      WHERE p.role <> 'admin'
        AND ($1 = '' OR p.academy_id ILIKE '%' || $1 || '%' OR p.full_name ILIKE '%' || $1 || '%' OR p.admission_id ILIKE '%' || $1 || '%')
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 200
    `, [search]);
    return json(200, { data: result.rows, requestId });
  } catch (error) {
    context.error("List students failed", error);
    return errorResponse(error, requestId);
  }
}

async function listInvitations(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    await requireAdmin(request);
    const result = await query(`
      SELECT i.id, i.admission_id, i.allowed_academy_id, i.assigned_role, i.expires_at,
             i.created_at, i.claimed_at, p.academy_id AS claimed_by_academy_id
      FROM admission_invites i
      LEFT JOIN user_profiles p ON p.id = i.claimed_by
      ORDER BY i.created_at DESC
      LIMIT 200
    `);
    return json(200, { data: result.rows, requestId });
  } catch (error) {
    context.error("List admission invitations failed", error);
    return errorResponse(error, requestId);
  }
}

async function createInvitation(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const admin = await requireAdmin(request);
    const input = await parseJson(request, invitationSchema);
    const allowedAcademyId = input.allowedAcademyId ? normalizeAcademyId(input.allowedAcademyId).academyId : "";
    const result = await query(`
      INSERT INTO admission_invites (admission_id, allowed_academy_id, assigned_role, expires_at)
      VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, '')::timestamptz)
      ON CONFLICT (admission_id) DO UPDATE SET
        allowed_academy_id = EXCLUDED.allowed_academy_id,
        assigned_role = EXCLUDED.assigned_role,
        expires_at = EXCLUDED.expires_at
      WHERE admission_invites.claimed_by IS NULL
      RETURNING id, admission_id, allowed_academy_id, assigned_role, expires_at, created_at
    `, [input.admissionId, allowedAcademyId, input.role, input.expiresAt || ""]);
    if (!result.rows[0]) throw new HttpError(409, "This Admission ID has already been claimed.", "ADMISSION_ID_CLAIMED");
    await query(`
      INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id)
      VALUES ($1, 'admission-invite.created', 'admission_invite', $2, $3)
    `, [admin.id, result.rows[0].id, requestId]);
    return json(201, { data: result.rows[0], requestId });
  } catch (error) {
    context.error("Create admission invitation failed", error);
    return errorResponse(error, requestId);
  }
}

async function updateStudentStatus(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const admin = await requireAdmin(request);
    const input = await parseJson(request, statusSchema);
    const result = await transaction(async (client) => {
      const updated = await client.query(`
        UPDATE user_profiles
        SET status = $1, updated_at = now()
        WHERE id = $2 AND role <> 'admin'
        RETURNING id, academy_id, username, full_name, admission_id, role, status, created_at
      `, [input.status, request.params.id]);
      if (!updated.rows[0]) throw new HttpError(404, "Student account not found.", "STUDENT_NOT_FOUND");
      if (input.status === "suspended") {
        await client.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [request.params.id]);
      }
      await client.query(`
        INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        VALUES ($1, 'student.status-changed', 'user_profile', $2, $3, jsonb_build_object('status', $4::text))
      `, [admin.id, request.params.id, requestId, input.status]);
      return updated.rows[0];
    });
    return json(200, { data: result, requestId });
  } catch (error) {
    context.error("Update student status failed", error);
    return errorResponse(error, requestId);
  }
}

async function resetStudentPassword(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const admin = await requireAdmin(request);
    const input = await parseJson(request, resetPasswordSchema);
    const passwordHash = await hashPassword(input.password);
    await transaction(async (client) => {
      const account = await client.query<{ id: string }>(`
        SELECT id FROM user_profiles WHERE id = $1 AND role <> 'admin' FOR UPDATE
      `, [request.params.id]);
      if (!account.rows[0]) throw new HttpError(404, "Student account not found.", "STUDENT_NOT_FOUND");
      await client.query(`
        UPDATE auth_credentials
        SET password_hash = $1, failed_attempts = 0, locked_until = NULL, password_changed_at = now()
        WHERE user_id = $2
      `, [passwordHash, request.params.id]);
      await client.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [request.params.id]);
      await client.query(`
        INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id)
        VALUES ($1, 'student.password-reset', 'user_profile', $2, $3)
      `, [admin.id, request.params.id, requestId]);
    });
    return { status: 204 };
  } catch (error) {
    context.error("Reset student password failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("adminListStudents", { route: "v1/admin/students", methods: ["GET"], authLevel: "anonymous", handler: listStudents });
app.http("adminListInvitations", { route: "v1/admin/invitations", methods: ["GET"], authLevel: "anonymous", handler: listInvitations });
app.http("adminCreateInvitation", { route: "v1/admin/invitations", methods: ["POST"], authLevel: "anonymous", handler: createInvitation });
app.http("adminUpdateStudentStatus", { route: "v1/admin/students/{id:guid}/status", methods: ["PATCH"], authLevel: "anonymous", handler: updateStudentStatus });
app.http("adminResetStudentPassword", { route: "v1/admin/students/{id:guid}/reset-password", methods: ["POST"], authLevel: "anonymous", handler: resetStudentPassword });
