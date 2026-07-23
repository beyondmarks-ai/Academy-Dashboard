import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { getPool } from "../db.js";
import { errorResponse, json } from "../http.js";

function diagnostic(error: unknown) {
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    name: typeof candidate?.name === "string" ? candidate.name : "UnknownError",
    code: typeof candidate?.code === "string" ? candidate.code : "UNKNOWN",
  };
}

async function runMigration(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const requestId = context.invocationId;
  let migrations: Array<{ name: string; sql: string }>;

  try {
    const migrationsDirectory = resolve(process.cwd(), "migrations");
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    migrations = await Promise.all(migrationFiles.map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationsDirectory, name), "utf8"),
    })));
  } catch (error) {
    context.error("Database migration file could not be loaded", error);
    return json(500, {
      error: { code: "MIGRATION_FILE_ERROR", message: "The migration file could not be loaded.", requestId },
      diagnostic: diagnostic(error),
    });
  }

  try {
    for (const migration of migrations) await getPool().query(migration.sql);
    return json(200, { status: "migrated", migrations: migrations.map((item) => item.name), requestId });
  } catch (error) {
    context.error("Database migration failed", error);
    const response = errorResponse(error, requestId);
    return { ...response, jsonBody: { ...(response.jsonBody as object), diagnostic: diagnostic(error) } };
  }
}

app.http("runMigration", {
  route: "internal/migrate",
  methods: ["POST"],
  authLevel: "function",
  handler: runMigration,
});
