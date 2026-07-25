import { beforeAll, describe, expect, it } from "vitest";

describe("API credential encryption", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    process.env.API_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("encrypts with authenticated randomized ciphertext and decrypts exactly", async () => {
    const { decryptApiCredential, encryptApiCredential } = await import("../src/credentialCrypto.js");
    const credential = "sk-beyond-marks-private-test-key";
    const first = encryptApiCredential(credential);
    const second = encryptApiCredential(credential);

    expect(first).not.toBe(credential);
    expect(second).not.toBe(first);
    expect(decryptApiCredential(first)).toBe(credential);
    expect(decryptApiCredential(second)).toBe(credential);
  });

  it("rejects modified ciphertext", async () => {
    const { decryptApiCredential, encryptApiCredential } = await import("../src/credentialCrypto.js");
    const encrypted = encryptApiCredential("sk-private-key");
    expect(() => decryptApiCredential(`${encrypted.slice(0, -1)}A`)).toThrow();
  });
});
