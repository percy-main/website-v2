import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timestamp = new Date().toISOString();
const filename = `${timestamp}.ts`;
const filepath = path.join(__dirname, "../src/migrations", filename);

const template = `import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // TODO: implement migration
}
`;

await writeFile(filepath, template);
console.log(`Created migration: ${filename}`);
