import "dotenv/config";
import { sql } from "kysely";
import { createClient } from "../src/client.js";

/**
 * Local-dev only. Sets known passwords + LOGIN on `app_rw` and `app_ddl`
 * (created NOLOGIN by the role-split migration) and prints the env-var
 * lines to copy into apps/api/.env.
 *
 * In production both roles' passwords are minted by Terraform and seeded
 * into Postgres via a one-time admin ALTER USER over Tailscale — never
 * run this there. See docs/adrs/ for the bootstrap procedure.
 */

const APP_RW_PASSWORD = "app_rw_dev";
const APP_DDL_PASSWORD = "app_ddl_dev";

const adminUrl =
  process.env.DATABASE_URL ??
  "postgres://percy:percy@localhost:5433/percy_main";

if (!/localhost|127\.0\.0\.1/.test(adminUrl)) {
  console.error(
    `Refusing to run: DATABASE_URL (${adminUrl}) does not look local. ` +
      `This script is for local dev only.`,
  );
  process.exit(1);
}

const { client } = createClient(adminUrl);

await sql`ALTER USER app_rw WITH LOGIN PASSWORD ${sql.lit(
  APP_RW_PASSWORD,
)}`.execute(client);
await sql`ALTER USER app_ddl WITH LOGIN PASSWORD ${sql.lit(
  APP_DDL_PASSWORD,
)}`.execute(client);

await client.destroy();

const buildUrl = (user: string, password: string) =>
  adminUrl.replace(
    /^postgres(ql)?:\/\/[^@]+@/,
    `postgres://${user}:${password}@`,
  );

console.log("✓ app_rw + app_ddl are now LOGIN with dev passwords");
console.log("");
console.log("Add these to apps/api/.env (replacing DATABASE_URL):");
console.log("");
console.log(`DATABASE_URL=${buildUrl("app_rw", APP_RW_PASSWORD)}`);
console.log(`DATABASE_MIGRATION_URL=${buildUrl("app_ddl", APP_DDL_PASSWORD)}`);
