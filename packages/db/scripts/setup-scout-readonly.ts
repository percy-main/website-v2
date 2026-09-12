import "dotenv/config";
import { sql } from "kysely";
import { createClient } from "../src/client.js";

/**
 * Local-dev only. Sets a known password on `scout_readonly` and prints the
 * SCOUT_DB_URL line to copy into apps/api/.env. In production the role's
 * password is set by Terraform from Secrets Manager — never run this there.
 */

const DEV_PASSWORD = "scout_readonly_dev";

const adminUrl =
  process.env.DATABASE_URL ??
  "postgres://percy:percy@localhost:5433/percy_main";

const adminHostname = new URL(adminUrl).hostname;
if (adminHostname !== "localhost" && adminHostname !== "127.0.0.1") {
  console.error(
    `Refusing to run: DATABASE_URL (${adminUrl}) does not look local. ` +
      `This script is for local dev only.`,
  );
  process.exit(1);
}

const { client } = createClient(adminUrl);

await sql`ALTER USER scout_readonly WITH LOGIN PASSWORD ${sql.lit(
  DEV_PASSWORD,
)}`.execute(client);

await client.destroy();

const scoutUrl = adminUrl.replace(
  /^postgres(ql)?:\/\/[^@]+@/,
  `postgres://scout_readonly:${DEV_PASSWORD}@`,
);

console.log("✓ scout_readonly is now LOGIN with the dev password");
console.log("");
console.log("Add this to apps/api/.env:");
console.log("");
console.log(`SCOUT_DB_URL=${scoutUrl}`);
