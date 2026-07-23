import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { ensureProfile, requireAuth } from "../auth.js";
import { errorResponse, json } from "../http.js";

async function getMe(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    return json(200, { data: profile, requestId });
  } catch (error) {
    context.error("Get profile failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("getMe", {
  route: "v1/me",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: getMe,
});
