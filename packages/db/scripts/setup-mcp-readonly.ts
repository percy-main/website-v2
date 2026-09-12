import "dotenv/config";
import { sql } from "kysely";
import { createClient } from "../src/client.js";

/**
 * Local-dev only. Sets a known password on `mcp_readonly` and prints the
 * MCP_DB_URL line to copy into apps/api/.env. In production the role's
 * password is set by Terraform from Secrets Manager — never run this there.
 */

const DEV_PASSWORD = "mcp_readonly_dev";

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

await sql`ALTER USER mcp_readonly WITH LOGIN PASSWORD ${sql.lit(
  DEV_PASSWORD,
)}`.execute(client);

await client.destroy();

const mcpUrl = adminUrl.replace(
  /^postgres(ql)?:\/\/[^@]+@/,
  `postgres://mcp_readonly:${DEV_PASSWORD}@`,
);

console.log("✓ mcp_readonly is now LOGIN with the dev password");
console.log("");
console.log("Add this to apps/api/.env:");
console.log("");
console.log(`MCP_DB_URL=${mcpUrl}`);
