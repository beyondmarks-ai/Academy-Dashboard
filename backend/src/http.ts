import type { HttpResponseInit } from "@azure/functions";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "REQUEST_FAILED") {
    super(message);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  };
}

export async function parseJson<T>(request: { json(): Promise<unknown> }, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, "A valid JSON request body is required.", "INVALID_JSON");
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new HttpError(422, result.error.issues.map((issue) => issue.message).join("; "), "VALIDATION_FAILED");
  }
  return result.data;
}

export function errorResponse(error: unknown, requestId: string): HttpResponseInit {
  if (error instanceof HttpError) {
    return json(error.status, { error: { code: error.code, message: error.message, requestId } });
  }
  return json(500, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", requestId } });
}
