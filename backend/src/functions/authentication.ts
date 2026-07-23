import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { query, transaction } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import {
  consumeRateLimit,
  createSession,
  getClientMetadata,
  getDummyPasswordHash,
  hashOpaqueToken,
  hashPassword,
  normalizeAcademyId,
  verifyPassword,
} from "../security.js";

const passwordSchema = z.string()
  .min(12, "Password must contain at least 12 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  academyId: z.string().trim().min(5).max(80),
  admissionId: z.string().trim().min(3).max(80),
  password: passwordSchema,
});

const loginSchema = z.object({
  academyId: z.string().trim().min(5).max(80),
  password: z.string().min(1).max(128),
});

type LoginRow = {
  id: string;
  academy_id: string;
  username: string;
  full_name: string;
  admission_id: string | null;
  role: string;
  status: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: string | null;
};

function publicProfile(profile: { id: string; academy_id: string; username: string; full_name: string; admission_id: string | null; role: string; status: string }) {
  return {
    id: profile.id,
    academy_id: profile.academy_id,
    username: profile.username,
    full_name: profile.full_name,
    admission_id: profile.admission_id,
    role: profile.role,
    status: profile.status,
  };
}

async function signup(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const input = await parseJson(request, signupSchema);
    const { academyId, username } = normalizeAcademyId(input.academyId);
    const { ipHash } = getClientMetadata(request);
    await Promise.all([
      consumeRateLimit(`signup:academy:${academyId}`, 5, 3600),
      consumeRateLimit(`signup:ip:${ipHash}`, 12, 3600),
      consumeRateLimit(`signup:admission:${input.admissionId.toLowerCase()}`, 5, 3600),
    ]);
    const passwordHash = await hashPassword(input.password);

    const profile = await transaction(async (client) => {
      const invite = await client.query<{ id: string }>(`
        SELECT id FROM admission_invites
        WHERE admission_id = $1
          AND claimed_by IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND (allowed_academy_id IS NULL OR lower(allowed_academy_id) = $2)
        FOR UPDATE
      `, [input.admissionId, academyId]);
      if (!invite.rows[0]) {
        throw new HttpError(403, "This Admission ID is invalid, expired, assigned to another Academy ID, or already claimed.", "INVALID_ADMISSION_ID");
      }

      const created = await client.query<{
        id: string; academy_id: string; username: string; full_name: string; admission_id: string; role: string; status: string;
      }>(`
        INSERT INTO user_profiles (academy_id, username, full_name, admission_id, role, status)
        VALUES ($1, $2, $3, $4, 'student', 'active')
        RETURNING id, academy_id, username, full_name, admission_id, role, status
      `, [academyId, username, input.fullName, input.admissionId]);
      const user = created.rows[0]!;
      await client.query(`INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1, $2)`, [user.id, passwordHash]);
      await client.query(`UPDATE admission_invites SET claimed_by = $1, claimed_at = now() WHERE id = $2`, [user.id, invite.rows[0].id]);
      await client.query(`
        INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id)
        VALUES ($1::uuid, 'account.created', 'user_profile', $1::text, $2)
      `, [user.id, requestId]);
      return user;
    });

    const session = await createSession(profile.id, request);
    return json(201, { data: { profile: publicProfile(profile), session }, requestId });
  } catch (error) {
    context.error("Academy signup failed", error);
    const code = (error as { code?: string })?.code;
    return errorResponse(code === "23505" ? new HttpError(409, "This Academy ID is already registered.", "ACADEMY_ID_EXISTS") : error, requestId);
  }
}

async function login(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const input = await parseJson(request, loginSchema);
    const { academyId } = normalizeAcademyId(input.academyId);
    const { ipHash } = getClientMetadata(request);
    await Promise.all([
      consumeRateLimit(`login:academy:${academyId}`, 12, 900),
      consumeRateLimit(`login:ip:${ipHash}`, 40, 900),
    ]);

    const result = await query<LoginRow>(`
      SELECT p.id, p.academy_id, p.username, p.full_name, p.admission_id, p.role, p.status,
             c.password_hash, c.failed_attempts, c.locked_until
      FROM user_profiles p
      JOIN auth_credentials c ON c.user_id = p.id
      WHERE lower(p.academy_id) = $1
      LIMIT 1
    `, [academyId]);
    const account = result.rows[0];
    const passwordMatches = await verifyPassword(input.password, account?.password_hash || await getDummyPasswordHash());
    const locked = account?.locked_until && new Date(account.locked_until).getTime() > Date.now();

    if (!account || !passwordMatches || locked || account.status !== "active") {
      if (account && !passwordMatches) {
        await query(`
          UPDATE auth_credentials
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
          WHERE user_id = $1
        `, [account.id]);
      }
      throw new HttpError(401, "Academy ID or password is incorrect, or the account is temporarily locked.", "AUTHENTICATION_FAILED");
    }

    await query(`UPDATE auth_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1`, [account.id]);
    const session = await createSession(account.id, request);
    await query(`
      INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id)
      VALUES ($1::uuid, 'account.login', 'user_profile', $1::text, $2)
    `, [account.id, requestId]);
    return json(200, { data: { profile: publicProfile(account), session }, requestId });
  } catch (error) {
    context.error("Academy login failed", error);
    return errorResponse(error, requestId);
  }
}

async function logout(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (token) await query(`UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashOpaqueToken(token)]);
    return { status: 204 };
  } catch (error) {
    context.error("Academy logout failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("academySignup", { route: "v1/auth/signup", methods: ["POST"], authLevel: "anonymous", handler: signup });
app.http("academyLogin", { route: "v1/auth/login", methods: ["POST"], authLevel: "anonymous", handler: login });
app.http("academyLogout", { route: "v1/auth/logout", methods: ["POST"], authLevel: "anonymous", handler: logout });
