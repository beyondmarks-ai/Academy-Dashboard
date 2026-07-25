import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "./config.js";

function encryptionKey() {
  const configured = getConfig().API_CREDENTIAL_ENCRYPTION_KEY;
  if (!configured) throw new Error("API credential encryption is not configured.");
  const source = Buffer.from(configured, "base64");
  if (source.length !== 32) throw new Error("API credential encryption key must be 32 bytes.");
  return createHash("sha256").update(source).update("beyond-marks-api-credential-v1").digest();
}

export function encryptApiCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

export function decryptApiCredential(value: string) {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) throw new Error("The stored API credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
