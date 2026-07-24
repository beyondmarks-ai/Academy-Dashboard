import { describe, expect, it } from "vitest";
import { hashPassword, normalizeAcademyId, verifyPassword } from "../src/security.js";
import { requireRole } from "../src/auth.js";

describe("Academy authentication security", () => {
  it("normalizes only Beyond Marks Academy IDs", () => {
    expect(normalizeAcademyId("  Student.01@BeyondMarks.ai ")).toEqual({
      academyId: "student.01@beyondmarks.ai",
      username: "student.01",
    });
    expect(() => normalizeAcademyId("student@example.com")).toThrow("Academy ID");
  });

  it("hashes and verifies passwords without retaining plaintext", async () => {
    const password = "Strong-Academy-Password-2026";
    const encoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password, encoded)).resolves.toBe(true);
    await expect(verifyPassword("Wrong-Academy-Password-2026", encoded)).resolves.toBe(false);
  }, 20_000);

  it("matches authorized roles without casing restrictions", () => {
    const identity = {
      profileId: "00000000-0000-0000-0000-000000000001",
      academyId: "admin@beyondmarks.ai",
      name: "Academy Admin",
      username: "admin",
      admissionId: "BM-ADMIN",
      roles: ["admin"],
    };
    expect(() => requireRole(identity, "Admin")).not.toThrow();
    expect(() => requireRole(identity, "Student")).toThrow("permission");
  });
});
