import type { HttpRequest } from "@azure/functions";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getConfig } from "./config.js";
import { HttpError } from "./http.js";
import { query } from "./db.js";

export type AuthenticatedUser = {
  entraObjectId: string;
  email: string;
  name: string;
  username: string;
  admissionId: string;
  roles: string[];
  claims: JWTPayload;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function claimBySuffix(claims: JWTPayload, suffix: string): string {
  const entry = Object.entries(claims).find(([key, value]) => key.toLowerCase().endsWith(suffix.toLowerCase()) && typeof value === "string");
  return entry?.[1] as string || "";
}

export async function requireAuth(request: HttpRequest): Promise<AuthenticatedUser> {
  const config = getConfig();
  if (config.AUTH_DISABLED === "true" && config.NODE_ENV !== "production") {
    return {
      entraObjectId: request.headers.get("x-dev-user-id") || "00000000-0000-0000-0000-000000000001",
      email: request.headers.get("x-dev-user-email") || "student@beyondmarks.local",
      name: request.headers.get("x-dev-user-name") || "Development Student",
      username: request.headers.get("x-dev-username") || "student",
      admissionId: request.headers.get("x-dev-admission-id") || "DEV-001",
      roles: ["Student"],
      claims: {},
    };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "A bearer token is required.", "UNAUTHENTICATED");
  if (!config.ENTRA_ISSUER || !config.ENTRA_AUDIENCE || !config.ENTRA_JWKS_URI) {
    throw new HttpError(503, "Authentication is not configured.", "AUTH_NOT_CONFIGURED");
  }

  try {
    jwks ??= createRemoteJWKSet(new URL(config.ENTRA_JWKS_URI));
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer: config.ENTRA_ISSUER,
      audience: config.ENTRA_AUDIENCE,
    });
    const objectId = String(payload.oid || payload.sub || "");
    if (!objectId) throw new Error("Token has no stable subject.");
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : ["Student"];
    return {
      entraObjectId: objectId,
      email: String(payload.email || payload.preferred_username || ""),
      name: String(payload.name || "Student"),
      username: claimBySuffix(payload, "username") || String(payload.preferred_username || "").split("@")[0] || "student",
      admissionId: claimBySuffix(payload, "admissionid"),
      roles,
      claims: payload,
    };
  } catch {
    throw new HttpError(401, "The access token is invalid or expired.", "INVALID_TOKEN");
  }
}

export function requireRole(user: AuthenticatedUser, ...roles: string[]) {
  if (!roles.some((role) => user.roles.includes(role))) throw new HttpError(403, "You do not have permission for this action.", "FORBIDDEN");
}

export async function ensureProfile(user: AuthenticatedUser) {
  const result = await query<{
    id: string; entra_object_id: string; email: string; username: string; full_name: string; admission_id: string | null; role: string; status: string;
  }>(`
    INSERT INTO user_profiles (entra_object_id, email, username, full_name, admission_id, role)
    VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)
    ON CONFLICT (entra_object_id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      updated_at = now()
    RETURNING *
  `, [user.entraObjectId, user.email, user.username, user.name, user.admissionId, user.roles.includes("Admin") ? "admin" : "student"]);
  return result.rows[0];
}
