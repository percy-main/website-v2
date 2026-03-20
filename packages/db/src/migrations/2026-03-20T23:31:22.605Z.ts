import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE availability_fixture
    ADD COLUMN competition_type TEXT
  `.execute(db);
}
