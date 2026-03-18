import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Prevent duplicate match fee rates for the same scope.
  // Uses COALESCE to treat NULL (wildcard) as a consistent sentinel value
  // so the unique index works correctly with nullable columns.
  await sql`
    CREATE UNIQUE INDEX idx_match_fee_rate_unique_scope
    ON match_fee_rate (
      COALESCE(play_cricket_team_id, '__all__'),
      COALESCE(competition_type, '__any__'),
      member_category
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_match_fee_rate_unique_scope`.execute(db);
}
