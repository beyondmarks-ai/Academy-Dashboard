import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getConfig } from "./config.js";

let pool: Pool | undefined;

export function getPool() {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.NODE_ENV === "production" ? 10 : 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
    });
    pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error));
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
