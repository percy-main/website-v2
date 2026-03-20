import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // availability_request: a window-based request for availability
  await sql`
    CREATE TABLE availability_request (
      id TEXT PRIMARY KEY,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES "user"(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  // Link availability_date records to a request
  await sql`
    ALTER TABLE availability_date
    ADD COLUMN availability_request_id TEXT REFERENCES availability_request(id) ON DELETE CASCADE
  `.execute(db);

  // Drop the unique constraint on (play_cricket_team_id, match_date) since
  // the same date can appear in multiple requests (but we prevent overlap at the app layer)
  await sql`
    ALTER TABLE availability_date
    DROP CONSTRAINT availability_date_play_cricket_team_id_match_date_key
  `.execute(db);

  // Add a unique constraint including the request
  await sql`
    CREATE UNIQUE INDEX idx_availability_date_request_team_date
    ON availability_date (availability_request_id, play_cricket_team_id, match_date)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_availability_date_request_team_date`.execute(
    db,
  );
  await sql`ALTER TABLE availability_date DROP COLUMN IF EXISTS availability_request_id`.execute(
    db,
  );
  await sql`
    ALTER TABLE availability_date
    ADD CONSTRAINT availability_date_play_cricket_team_id_match_date_key
    UNIQUE (play_cricket_team_id, match_date)
  `.execute(db);
  await sql`DROP TABLE IF EXISTS availability_request`.execute(db);
}
