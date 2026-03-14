import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./__generated__/db.js";

/**
 * Creates a typed Kysely client for the given connection string.
 * This is a pure factory — no module-level singletons.
 */
export function createClient(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const dialect = new PostgresDialect({ pool });
  const client = new Kysely<DB>({ dialect });
  return { client, dialect, pool };
}
