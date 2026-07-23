import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { query } from "../db.js";
import { errorResponse, json } from "../http.js";

async function health(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const database = await query<{ now: string }>("SELECT now()::text AS now");
    return json(200, {
      status: "healthy",
      service: "academy-api",
      database: "connected",
      databaseTime: database.rows[0]?.now,
      requestId,
    });
  } catch (error) {
    context.error("Health check failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("health", {
  route: "v1/health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: health,
});
