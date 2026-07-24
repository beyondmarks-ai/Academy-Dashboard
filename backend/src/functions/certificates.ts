import { randomBytes, randomUUID } from "node:crypto";
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import { enqueueCertificate } from "../certificateQueue.js";
import { getConfig } from "../config.js";
import { query } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { downloadCertificateFile, uploadCertificateFile } from "../storage.js";

const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  imageBase64: z.string().min(100),
  prompt: z.string().trim().max(3000).default(""),
});

async function requireAdmin(request: HttpRequest) {
  const user = await requireAuth(request);
  requireRole(user, "Admin");
  return user;
}

async function cognitiveToken() {
  const config = getConfig();
  const credential = config.NODE_ENV === "production"
    ? new ManagedIdentityCredential({ clientId: config.AZURE_CLIENT_ID })
    : new AzureCliCredential();
  return (await credential.getToken("https://cognitiveservices.azure.com/.default")).token;
}

async function readText(image: Buffer) {
  const config = getConfig();
  if (!config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) throw new Error("Document Intelligence endpoint is not configured.");
  const response = await fetch(`${config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.replace(/\/$/, "")}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await cognitiveToken()}`, "content-type": "image/png" },
    body: new Uint8Array(image),
  });
  if (response.status !== 202) throw new Error(`OCR submission failed (${response.status}).`);
  const operation = response.headers.get("operation-location");
  if (!operation) throw new Error("OCR operation was not returned.");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = await fetch(operation, { headers: { Authorization: `Bearer ${await cognitiveToken()}` } });
    const result = await poll.json() as { status?: string; analyzeResult?: { content?: string }; error?: { message?: string } };
    if (result.status === "succeeded") return result.analyzeResult?.content || "";
    if (result.status === "failed") throw new Error(result.error?.message || "OCR validation failed.");
  }
  throw new Error("OCR validation timed out.");
}

function verificationNumber() {
  return `BM-CERT-${new Date().getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function uploadTemplate(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const administrator = await requireAdmin(request);
    const input = await parseJson(request, templateSchema);
    const data = Buffer.from(input.imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (data.length > 10_000_000) throw new HttpError(413, "Template exceeds 10 MB.");
    try { PNG.sync.read(data); } catch { throw new HttpError(400, "Template must be a valid PNG image."); }
    const version = await query<{ version: number }>(
      `SELECT coalesce(max(version), 0) + 1 AS version FROM certificate_templates WHERE name = $1`,
      [input.name],
    );
    const id = randomUUID();
    const blobName = `templates/${id}.png`;
    await uploadCertificateFile(blobName, data, "image/png");
    await query(`UPDATE certificate_templates SET active = false WHERE active`);
    const result = await query(`
      INSERT INTO certificate_templates(id, name, blob_name, prompt, version, active, uploaded_by)
      VALUES($1, $2, $3, $4, $5, true, $6) RETURNING *
    `, [id, input.name, blobName, input.prompt, version.rows[0]!.version, administrator.profileId]);
    return json(201, { data: result.rows[0] });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function generateCertificate(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const administrator = await requireAdmin(request);
    const enrollment = await query(`
      SELECT e.id, p.full_name, p.admission_number, c.title, e.completed_at
      FROM course_enrollments e
      JOIN user_profiles p ON p.id = e.student_id
      JOIN courses c ON c.id = e.course_id
      WHERE e.id = $1 AND e.status = 'completed' AND p.admission_number IS NOT NULL
    `, [request.params.id]);
    if (!enrollment.rowCount) throw new HttpError(409, "A completed enrollment with an admission number is required.");
    const template = await query(`SELECT id FROM certificate_templates WHERE active ORDER BY created_at DESC LIMIT 1`);
    if (!template.rowCount) throw new HttpError(409, "Upload an active certificate template first.");
    const details = enrollment.rows[0]!;
    const result = await query(`
      INSERT INTO certificates(
        verification_number, enrollment_id, template_id, student_name, admission_number,
        course_title, completion_date, issued_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [
      verificationNumber(), details.id, template.rows[0]!.id, details.full_name,
      details.admission_number, details.title, details.completed_at, administrator.profileId,
    ]);
    await enqueueCertificate(result.rows[0]!.id);
    return json(202, { data: result.rows[0] });
  } catch (error) {
    return errorResponse(error, context.invocationId);
  }
}

async function generationWorker(message: unknown, context: InvocationContext) {
  const certificateId = (message as { certificateId?: string })?.certificateId;
  if (!certificateId) return;
  const config = getConfig();
  try {
    const result = await query(`
      SELECT certificate.*, template.blob_name, template.prompt
      FROM certificates certificate
      JOIN certificate_templates template ON template.id = certificate.template_id
      WHERE certificate.id = $1 AND certificate.status IN ('draft', 'validation_failed')
    `, [certificateId]);
    if (!result.rowCount) return;
    const certificate = result.rows[0]!;
    await query(`UPDATE certificates SET status='generating', generation_attempts=generation_attempts+1 WHERE id=$1`, [certificateId]);
    if (!config.AZURE_FOUNDRY_ENDPOINT) throw new Error("Foundry endpoint is not configured.");
    const source = await downloadCertificateFile(certificate.blob_name);
    const form = new FormData();
    form.append("model", config.AZURE_FOUNDRY_IMAGE_DEPLOYMENT);
    form.append("image", new Blob([new Uint8Array(source)]), "template.png");
    form.append("prompt", `${certificate.prompt}
Preserve the exact certificate layout, logo, borders, seal and signature.
Replace only the variable certificate details:
recipient name: "${certificate.student_name}"
course: "${certificate.course_title}"
certificate number: "${certificate.verification_number}"
date: "${certificate.completion_date}"
Render every quoted value exactly and do not invent any text.`);
    const generated = await fetch(`${config.AZURE_FOUNDRY_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${config.AZURE_FOUNDRY_IMAGE_DEPLOYMENT}/images/edits?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await cognitiveToken()}` },
      body: form,
    });
    if (!generated.ok) throw new Error(`Foundry image edit failed (${generated.status}): ${(await generated.text()).slice(0, 300)}`);
    const payload = await generated.json() as { data?: Array<{ b64_json?: string }> };
    const image = Buffer.from(payload.data?.[0]?.b64_json || "", "base64");
    if (!image.length) throw new Error("Foundry returned no image.");

    const recognized = (await readText(image)).toLocaleLowerCase();
    const required = [certificate.student_name, certificate.course_title, certificate.verification_number];
    const missing = required.filter((value: string) => !recognized.includes(value.toLocaleLowerCase()));
    if (missing.length) throw new Error(`OCR validation failed for: ${missing.join(", ")}`);

    const canvas = PNG.sync.read(image);
    const qr = PNG.sync.read(await QRCode.toBuffer(`${config.PUBLIC_APP_URL}/verify/${certificate.verification_number}`, { width: 180, margin: 1 }));
    const left = Math.max(16, canvas.width - qr.width - 24);
    const top = Math.max(16, canvas.height - qr.height - 24);
    PNG.bitblt(qr, canvas, 0, 0, qr.width, qr.height, left, top);
    const finalImage = PNG.sync.write(canvas);
    const imageBlobName = `certificates/${certificateId}.png`;
    await uploadCertificateFile(imageBlobName, finalImage, "image/png");

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([canvas.width, canvas.height]);
    const embedded = await pdf.embedPng(finalImage);
    page.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });
    const pdfBlobName = `certificates/${certificateId}.pdf`;
    await uploadCertificateFile(pdfBlobName, Buffer.from(await pdf.save()), "application/pdf");
    await query(`
      UPDATE certificates SET status='issued', image_blob_name=$1, pdf_blob_name=$2,
        issued_at=now(), validation_details=$3 WHERE id=$4
    `, [imageBlobName, pdfBlobName, JSON.stringify({ ocrValidated: true }), certificateId]);
  } catch (error) {
    context.error("Certificate generation failed", error);
    await query(`
      UPDATE certificates SET status='validation_failed',
        validation_details=jsonb_build_object('error',$1::text) WHERE id=$2
    `, [error instanceof Error ? error.message : "Generation failed", certificateId]);
    throw error;
  }
}

app.http("adminCertificateTemplate", {
  route: "v1/admin/certificate-templates",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: uploadTemplate,
});
app.http("adminGenerateCertificate", {
  route: "v1/admin/enrollments/{id:guid}/certificate",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: generateCertificate,
});
app.storageQueue("generateCertificateWorker", {
  queueName: "certificate-generation",
  connection: "AzureWebJobsStorage",
  handler: generationWorker,
});
