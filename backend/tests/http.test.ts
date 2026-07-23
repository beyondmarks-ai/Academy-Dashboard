import { describe, expect, it } from "vitest";
import { HttpError, errorResponse, json } from "../src/http.js";

describe("HTTP response helpers", () => {
  it("creates no-store JSON responses", () => {
    const response = json(200, { ok: true });
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({ "cache-control": "no-store" });
  });

  it("maps expected errors without leaking internals", () => {
    const response = errorResponse(new HttpError(404, "Missing", "NOT_FOUND"), "request-1");
    expect(response.status).toBe(404);
    expect(response.jsonBody).toEqual({ error: { code: "NOT_FOUND", message: "Missing", requestId: "request-1" } });
  });
});
