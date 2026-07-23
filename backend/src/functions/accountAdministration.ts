import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { transaction } from "../db.js";
import { errorResponse, HttpError } from "../http.js";
import { normalizeAcademyId } from "../security.js";

async function deleteAcademyAccount(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const { academyId } = normalizeAcademyId(decodeURIComponent(request.params.academyId || ""));
    if (request.headers.get("x-confirm-academy-id")?.trim().toLowerCase() !== academyId) {
      throw new HttpError(400, "Account deletion requires an exact confirmation header.", "CONFIRMATION_REQUIRED");
    }

    await transaction(async (client) => {
      const account = await client.query<{ id: string }>(`
        SELECT id FROM user_profiles WHERE lower(academy_id) = $1 FOR UPDATE
      `, [academyId]);
      const profile = account.rows[0];
      if (!profile) throw new HttpError(404, "Academy account not found.", "ACCOUNT_NOT_FOUND");

      await client.query(`DELETE FROM admission_invites WHERE claimed_by = $1`, [profile.id]);
      await client.query(`UPDATE audit_events SET actor_id = NULL WHERE actor_id = $1`, [profile.id]);
      await client.query(`DELETE FROM user_profiles WHERE id = $1`, [profile.id]);
      await client.query(`
        INSERT INTO audit_events (action, entity_type, entity_id, request_id, metadata)
        VALUES ('account.deleted', 'user_profile', $1, $2, jsonb_build_object('academyId', $1::text))
      `, [academyId, requestId]);
    });
    return { status: 204 };
  } catch (error) {
    context.error("Academy account deletion failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("deleteAcademyAccount", {
  route: "internal/accounts/{academyId}",
  methods: ["DELETE"],
  authLevel: "function",
  handler: deleteAcademyAccount,
});
