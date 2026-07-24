import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { ensureProfile, requireAuth, requireRole } from "../auth.js";
import { query } from "../db.js";
import { errorResponse, HttpError, json } from "../http.js";
import { downloadCertificateFile } from "../storage.js";

async function admin(request: HttpRequest) {
  const user = await requireAuth(request);
  requireRole(user, "Admin");
}

async function listEnrollments(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await admin(request);
    const result = await query(`
      SELECT e.*, c.code course_code, c.title course_title, p.full_name student_name,
        p.academy_id, p.admission_number
      FROM course_enrollments e JOIN courses c ON c.id=e.course_id
      JOIN user_profiles p ON p.id=e.student_id
      WHERE ($1='' OR e.course_id::text=$1) ORDER BY e.updated_at DESC
    `, [request.query.get("courseId") || ""]);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function listCertificates(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await admin(request);
    const result = await query(`SELECT * FROM certificates ORDER BY created_at DESC LIMIT 500`);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function listTemplates(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await admin(request);
    const result = await query(`SELECT id,name,version,active,created_at FROM certificate_templates ORDER BY created_at DESC`);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function listCampaigns(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await admin(request);
    const result = await query(`
      SELECT c.*, count(r.user_id)::int recipient_count,
        count(r.user_id) FILTER(WHERE r.read_at IS NOT NULL)::int read_count
      FROM notification_campaigns c LEFT JOIN notification_recipients r ON r.campaign_id=c.id
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 300
    `);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function learnerCourses(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query(`
      SELECT e.*, c.code, c.title, c.description, c.duration
      FROM course_enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.student_id=$1 ORDER BY e.updated_at DESC
    `, [profile!.id]);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function learnerCertificates(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query(`
      SELECT certificate.id,certificate.verification_number,certificate.course_title,
        certificate.completion_date,certificate.issued_at,certificate.status
      FROM certificates certificate JOIN course_enrollments enrollment ON enrollment.id=certificate.enrollment_id
      WHERE enrollment.student_id=$1 AND certificate.status IN('issued','revoked')
      ORDER BY certificate.created_at DESC
    `, [profile!.id]);
    return json(200, { data: result.rows });
  } catch (error) { return errorResponse(error, context.invocationId); }
}

async function downloadCertificate(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const profile = await ensureProfile(await requireAuth(request));
    const result = await query<{ pdf_blob_name: string }>(`
      SELECT certificate.pdf_blob_name FROM certificates certificate
      JOIN course_enrollments enrollment ON enrollment.id=certificate.enrollment_id
      WHERE certificate.id=$1 AND certificate.status='issued'
        AND (enrollment.student_id=$2 OR $3='admin')
    `, [request.params.id, profile!.id, profile!.role]);
    if (!result.rows[0]?.pdf_blob_name) throw new HttpError(404, "Certificate not found.");
    const file = await downloadCertificateFile(result.rows[0].pdf_blob_name);
    return { status: 200, body: file, headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="Beyond-Marks-Certificate.pdf"` } };
  } catch (error) { return errorResponse(error, context.invocationId); }
}

app.http("adminListEnrollments",{route:"v1/admin/enrollments",methods:["GET"],authLevel:"anonymous",handler:listEnrollments});
app.http("adminListCertificates",{route:"v1/admin/certificates",methods:["GET"],authLevel:"anonymous",handler:listCertificates});
app.http("adminListCertificateTemplates",{route:"v1/admin/certificate-templates",methods:["GET"],authLevel:"anonymous",handler:listTemplates});
app.http("adminListCampaigns",{route:"v1/admin/notifications",methods:["GET"],authLevel:"anonymous",handler:listCampaigns});
app.http("learnerCourses",{route:"v1/courses",methods:["GET"],authLevel:"anonymous",handler:learnerCourses});
app.http("learnerCertificates",{route:"v1/certificates",methods:["GET"],authLevel:"anonymous",handler:learnerCertificates});
app.http("downloadCertificate",{route:"v1/certificates/{id:guid}/download",methods:["GET"],authLevel:"anonymous",handler:downloadCertificate});
