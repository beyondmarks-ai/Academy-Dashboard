import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(resolve(here, "../migrations/001_initial.sql"), "utf8");

try {
  await getPool().query(migration);
  console.log("Database migration completed.");
} finally {
  await getPool().end();
}
