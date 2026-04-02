import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE document
    ADD COLUMN history JSONB NOT NULL DEFAULT '[]'::jsonb
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE document
    DROP COLUMN history
  `.execute(db);
}
