import { createHash } from "node:crypto";
import type { HttpRequest } from "@azure/functions";
import { getConfig } from "./config.js";
import { HttpError } from "./http.js";
import { query } from "./db.js";

export type ProfileRow = {
  id: string;
  entra_object_id: string | null;
  email: string | null;
  academy_id: string | null;
  username: string;
  full_name: string;
  admission_id: string | null;
  role: "student" | "admin" | "developer";
  status: "active" | "suspended" | "pending";
};

export type AuthenticatedUser = {
  profileId: string;
  academyId: string;
  name: string;
  username: string;
  admissionId: string;
  roles: string[];
};

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function requireAuth(request: HttpRequest): Promise<AuthenticatedUser> {
  const config = getConfig();
  if (config.AUTH_DISABLED === "true" && config.NODE_ENV !== "production") {
    return {
      profileId: request.headers.get("x-dev-user-id") || "00000000-0000-0000-0000-000000000001",
      academyId: request.headers.get("x-dev-academy-id") || "student@beyondmarks.ai",
      name: request.headers.get("x-dev-user-name") || "Development Student",
      username: request.headers.get("x-dev-username") || "student",
      admissionId: request.headers.get("x-dev-admission-id") || "DEV-001",
      roles: ["Student"],
    };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "A valid Academy session is required.", "UNAUTHENTICATED");
  }

  const token = authorization.slice(7).trim();
  if (token.length < 32 || token.length > 512) {
    throw new HttpError(401, "The Academy session is invalid or expired.", "INVALID_SESSION");
  }

  const result = await query<ProfileRow>(`
    SELECT p.id, p.entra_object_id, p.email, p.academy_id, p.username, p.full_name,
           p.admission_id, p.role, p.status
    FROM auth_sessions s
    JOIN user_profiles p ON p.id = s.user_id
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1
  `, [hashSessionToken(token)]);
  const profile = result.rows[0];
  if (!profile || profile.status !== "active" || !profile.academy_id) {
    throw new HttpError(401, "The Academy session is invalid or expired.", "INVALID_SESSION");
  }

  await query(`
    UPDATE auth_sessions
    SET last_seen_at = now()
    WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'
  `, [hashSessionToken(token)]);

  return {
    profileId: profile.id,
    academyId: profile.academy_id,
    name: profile.full_name,
    username: profile.username,
    admissionId: profile.admission_id || "",
    roles: [profile.role[0]!.toUpperCase() + profile.role.slice(1)],
  };
}

export function requireRole(user: AuthenticatedUser, ...roles: string[]) {
  if (!roles.some((role) => user.roles.includes(role))) {
    throw new HttpError(403, "You do not have permission for this action.", "FORBIDDEN");
  }
}

export async function ensureProfile(user: AuthenticatedUser) {
  const result = await query<ProfileRow>(`
    SELECT id, entra_object_id, email, academy_id, username, full_name,
           admission_id, role, status
    FROM user_profiles
    WHERE id = $1
  `, [user.profileId]);
  const profile = result.rows[0];
  if (!profile) throw new HttpError(401, "The Academy account no longer exists.", "ACCOUNT_NOT_FOUND");
  return profile;
}
