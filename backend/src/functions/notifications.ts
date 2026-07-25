import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { ensureProfile, requireAuth } from "../auth.js";
import { query } from "../db.js";
import { errorResponse, HttpError, json } from "../http.js";

type NotificationRow = { id: string; title: string; message: string; category: string; priority: "normal" | "important" | "urgent"; created_at: string; unread: boolean };

async function listNotifications(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query<NotificationRow>(`
      SELECT c.id, c.title, c.message, c.category, c.priority, c.publish_at AS created_at, (r.read_at IS NULL) AS unread
      FROM notification_campaigns c JOIN notification_recipients r ON r.campaign_id=c.id
      WHERE r.user_id=$1 AND c.cancelled_at IS NULL AND c.publish_at<=now()
        AND (c.expires_at IS NULL OR c.expires_at>now())
      UNION ALL
      SELECT n.id, n.title, n.message, n.category, 'normal'::text AS priority, n.created_at, (nr.notification_id IS NULL) AS unread
      FROM notifications n
      LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
      WHERE (n.user_id IS NULL OR n.user_id = $1) AND (n.expires_at IS NULL OR n.expires_at > now())
      ORDER BY created_at DESC LIMIT 100
    `, [profile!.id]);
    return json(200, { data: result.rows, unreadCount: result.rows.filter((item) => item.unread).length, requestId });
  } catch (error) {
    context.error("List notifications failed", error);
    return errorResponse(error, requestId);
  }
}

async function markNotificationRead(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const notificationId = request.params.id;
    const campaign = await query(`UPDATE notification_recipients SET read_at=coalesce(read_at,now()) WHERE campaign_id=$1 AND user_id=$2`, [notificationId, profile!.id]);
    if (campaign.rowCount) return { status: 204 };
    const exists = await query(`SELECT 1 FROM notifications WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`, [notificationId, profile!.id]);
    if (!exists.rowCount) throw new HttpError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
    await query(`INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [notificationId, profile!.id]);
    return { status: 204 };
  } catch (error) {
    context.error("Mark notification read failed", error);
    return errorResponse(error, requestId);
  }
}

async function markAllRead(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const profile = await ensureProfile(await requireAuth(request));
    await query(`
      UPDATE notification_recipients SET read_at=coalesce(read_at,now())
      WHERE user_id=$1 AND read_at IS NULL
    `, [profile!.id]);
    await query(`
      INSERT INTO notification_reads (notification_id, user_id)
      SELECT id, $1 FROM notifications WHERE user_id IS NULL OR user_id = $1
      ON CONFLICT DO NOTHING
    `, [profile!.id]);
    return { status: 204 };
  } catch (error) {
    context.error("Mark all notifications read failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("listNotifications", { route: "v1/notifications", methods: ["GET"], authLevel: "anonymous", handler: listNotifications });
app.http("markNotificationRead", { route: "v1/notifications/{id:guid}/read", methods: ["PATCH"], authLevel: "anonymous", handler: markNotificationRead });
app.http("markAllNotificationsRead", { route: "v1/notifications/read-all", methods: ["POST"], authLevel: "anonymous", handler: markAllRead });
