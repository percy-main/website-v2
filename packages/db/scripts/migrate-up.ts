import "dotenv/config";
import { promises as fs } from "fs";
import { FileMigrationProvider, Migrator } from "kysely";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://percy:percy@localhost:5433/percy_main";
const { client } = createClient(connectionString);

const migrator = new Migrator({
  db: client,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(__dirname, "../src/migrations"),
  }),
});

const { error, results } = await migrator.migrateToLatest();

results?.forEach((it) => {
  if (it.status === "Success") {
    console.log(`  ✓ ${it.migrationName}`);
  } else if (it.status === "Error") {
    console.error(`  ✗ ${it.migrationName}`);
  }
});

if (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}

console.log(`\nMigrations complete (${results?.length ?? 0} applied)`);
await client.destroy();
