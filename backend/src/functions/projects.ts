import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { z } from "zod";
import { ensureProfile, requireAuth } from "../auth.js";
import { query } from "../db.js";
import { errorResponse, HttpError, json, parseJson } from "../http.js";
import { downloadText, uploadReadme } from "../storage.js";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  status: z.enum(["working", "finished"]),
  githubUrl: z.string().url().max(500).optional().or(z.literal("")),
  readme: z.string().max(2_000_000),
});

type ProjectRow = {
  id: string; name: string; description: string; status: "working" | "finished"; github_url: string | null;
  readme_blob_name: string | null; created_at: string; updated_at: string;
};

async function listProjects(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const user = await requireAuth(request);
    const profile = await ensureProfile(user);
    const status = request.query.get("status");
    if (status && !["working", "finished"].includes(status)) throw new HttpError(400, "Invalid project status.", "INVALID_STATUS");
    const result = await query<ProjectRow>(`
      SELECT id, name, description, status, github_url, readme_blob_name, created_at, updated_at
      FROM projects
      WHERE owner_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY updated_at DESC
    `, [profile?.id, status || null]);
    return json(200, { data: result.rows, requestId });
  } catch (error) {
    context.error("List projects failed", error);
    return errorResponse(error, requestId);
  }
}

async function createProject(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const user = await requireAuth(request);
    const profile = await ensureProfile(user);
    const input = await parseJson(request, createProjectSchema);
    const projectId = randomUUID();
    const blobName = await uploadReadme(profile!.id, projectId, input.readme);
    const result = await query<ProjectRow>(`
      INSERT INTO projects (id, owner_id, name, description, status, github_url, readme_blob_name)
      VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7)
      RETURNING id, name, description, status, github_url, readme_blob_name, created_at, updated_at
    `, [projectId, profile!.id, input.name, input.description, input.status, input.githubUrl || "", blobName]);
    await query(`INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id) VALUES ($1, 'project.created', 'project', $2, $3)`, [profile!.id, projectId, requestId]);
    return json(201, { data: result.rows[0], requestId });
  } catch (error) {
    context.error("Create project failed", error);
    return errorResponse(error, requestId);
  }
}

async function getProject(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  try {
    const user = await requireAuth(request);
    const profile = await ensureProfile(user);
    const projectId = request.params.id;
    const result = await query<ProjectRow>(`
      SELECT id, name, description, status, github_url, readme_blob_name, created_at, updated_at
      FROM projects WHERE id = $1 AND owner_id = $2
    `, [projectId, profile!.id]);
    const project = result.rows[0];
    if (!project) throw new HttpError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const readme = project.readme_blob_name ? await downloadText(project.readme_blob_name) : "";
    return json(200, { data: { ...project, readme }, requestId });
  } catch (error) {
    context.error("Get project failed", error);
    return errorResponse(error, requestId);
  }
}

app.http("listProjects", { route: "v1/projects", methods: ["GET"], authLevel: "anonymous", handler: listProjects });
app.http("createProject", { route: "v1/projects", methods: ["POST"], authLevel: "anonymous", handler: createProject });
app.http("getProject", { route: "v1/projects/{id:guid}", methods: ["GET"], authLevel: "anonymous", handler: getProject });
