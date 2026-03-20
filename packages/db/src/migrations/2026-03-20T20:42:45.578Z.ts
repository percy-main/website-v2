import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── availability_request ──
  await sql`
    CREATE TABLE availability_request (
      id TEXT PRIMARY KEY,
      created_by TEXT NOT NULL REFERENCES "user"(id),
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_request_status ON availability_request (status)
  `.execute(db);

  // ── availability_fixture ──
  await sql`
    CREATE TABLE availability_fixture (
      id TEXT PRIMARY KEY,
      availability_request_id TEXT NOT NULL REFERENCES availability_request(id) ON DELETE CASCADE,
      match_date TEXT NOT NULL,
      play_cricket_match_id TEXT NOT NULL,
      play_cricket_team_id TEXT NOT NULL REFERENCES play_cricket_team(id),
      opposition TEXT NOT NULL,
      is_home BOOLEAN NOT NULL,
      competition_name TEXT,
      match_time TEXT,
      UNIQUE (availability_request_id, play_cricket_match_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_fixture_request ON availability_fixture (availability_request_id)
  `.execute(db);

  // ── availability_response ──
  await sql`
    CREATE TABLE availability_response (
      id TEXT PRIMARY KEY,
      availability_request_id TEXT NOT NULL REFERENCES availability_request(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES member(id),
      match_date TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      overridden_by TEXT REFERENCES "user"(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (availability_request_id, member_id, match_date)
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_response_request ON availability_response (availability_request_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_response_member ON availability_response (member_id)
  `.execute(db);

  // ── availability_assignment ──
  await sql`
    CREATE TABLE availability_assignment (
      id TEXT PRIMARY KEY,
      availability_fixture_id TEXT NOT NULL REFERENCES availability_fixture(id) ON DELETE CASCADE,
      member_id TEXT REFERENCES member(id),
      player_name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_assignment_fixture ON availability_assignment (availability_fixture_id)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_availability_assignment_member_fixture
    ON availability_assignment (availability_fixture_id, member_id)
    WHERE member_id IS NOT NULL
  `.execute(db);
}
