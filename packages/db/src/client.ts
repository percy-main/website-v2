import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./__generated__/db.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://percy:percy@localhost:5433/percy_main";

const dialect = new PostgresDialect({
  pool: new pg.Pool({
    connectionString,
    max: 10,
  }),
});

export const client = new Kysely<DB>({ dialect });
export { dialect };
