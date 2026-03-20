import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // availability_date: officials create dates they want availability for
  await sql`
    CREATE TABLE availability_date (
      id TEXT PRIMARY KEY,
      play_cricket_team_id TEXT NOT NULL REFERENCES play_cricket_team(id),
      match_date TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES "user"(id),
      created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (play_cricket_team_id, match_date)
    )
  `.execute(db);

  // player_availability: members declare availability per date
  await sql`
    CREATE TABLE player_availability (
      id TEXT PRIMARY KEY,
      availability_date_id TEXT NOT NULL REFERENCES availability_date(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES member(id),
      status TEXT NOT NULL CHECK (status IN ('available', 'unavailable', 'maybe')),
      notes TEXT,
      declared_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (availability_date_id, member_id)
    )
  `.execute(db);

  // fixture_assignment: captains assign available players to specific matchdays
  await sql`
    CREATE TABLE fixture_assignment (
      id TEXT PRIMARY KEY,
      availability_date_id TEXT NOT NULL REFERENCES availability_date(id) ON DELETE CASCADE,
      matchday_id TEXT NOT NULL REFERENCES matchday(id),
      member_id TEXT NOT NULL REFERENCES member(id),
      assigned_by TEXT NOT NULL REFERENCES "user"(id),
      assigned_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (matchday_id, member_id)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS fixture_assignment`.execute(db);
  await sql`DROP TABLE IF EXISTS player_availability`.execute(db);
  await sql`DROP TABLE IF EXISTS availability_date`.execute(db);
}
