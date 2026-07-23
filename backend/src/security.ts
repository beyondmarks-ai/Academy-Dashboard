import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { HttpRequest } from "@azure/functions";
import { query } from "./db.js";
import { HttpError } from "./http.js";

const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 192 * 1024 * 1024;
const SESSION_HOURS = 12;
const ACADEMY_DOMAIN = "beyondmarks.ai";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deriveKey(password: string, salt: Buffer, options = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, { ...options, maxmem: SCRYPT_MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !salt || !expected) return false;
  const options = { N: Number(n), r: Number(r), p: Number(p) };
  if (options.N !== SCRYPT_N || options.r !== SCRYPT_R || options.p !== SCRYPT_P) return false;
  const expectedBuffer = Buffer.from(expected, "base64url");
  const actual = await deriveKey(password, Buffer.from(salt, "base64url"), options);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

let dummyPasswordHash: Promise<string> | undefined;
export function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword("Not-A-Real-Academy-Password-2026");
  return dummyPasswordHash;
}

export function normalizeAcademyId(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = /^([a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])?)@beyondmarks\.ai$/.exec(normalized);
  if (!match) {
    throw new HttpError(422, `Academy ID must use the format student@${ACADEMY_DOMAIN}.`, "INVALID_ACADEMY_ID");
  }
  return { academyId: normalized, username: match[1]! };
}

export function getClientMetadata(request: HttpRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || request.headers.get("x-azure-socketip") || "unknown").slice(0, 80);
  return {
    ipHash: digest(ip),
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 400),
  };
}

export async function consumeRateLimit(key: string, limit: number, windowSeconds: number) {
  const result = await query<{ attempts: number }>(`
    INSERT INTO auth_rate_limits (key_hash, attempts, window_started_at)
    VALUES ($1, 1, now())
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE
        WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1
        ELSE auth_rate_limits.attempts + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now()
        ELSE auth_rate_limits.window_started_at
      END,
      updated_at = now()
    RETURNING attempts
  `, [digest(key), windowSeconds]);
  if ((result.rows[0]?.attempts || 0) > limit) {
    throw new HttpError(429, "Too many attempts. Please wait and try again.", "RATE_LIMITED");
  }
}

export async function createSession(userId: string, request: HttpRequest) {
  const token = randomBytes(32).toString("base64url");
  const { ipHash, userAgent } = getClientMetadata(request);
  const result = await query<{ expires_at: string }>(`
    INSERT INTO auth_sessions (token_hash, user_id, ip_hash, user_agent, expires_at)
    VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 hour'))
    RETURNING expires_at
  `, [digest(token), userId, ipHash, userAgent, SESSION_HOURS]);

  await query(`
    UPDATE auth_sessions
    SET revoked_at = now()
    WHERE token_hash IN (
      SELECT token_hash FROM auth_sessions
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
      OFFSET 5
    )
  `, [userId]);

  return { token, expiresAt: result.rows[0]!.expires_at, maxAge: SESSION_HOURS * 60 * 60 };
}

export function hashOpaqueToken(token: string) {
  return digest(token);
}
