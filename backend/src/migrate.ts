import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(here, "../migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();

try {
  for (const migrationFile of migrationFiles) {
    await getPool().query(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    console.log(`Applied ${migrationFile}.`);
  }
  console.log("Database migration completed.");
} finally {
  await getPool().end();
}
