import { type Kysely, sql } from "kysely";

/**
 * Let a captain pick a junior dependent into a SENIOR squad from the
 * availability date-detail picker. Mirrors `matchday_player.dependent_id`
 * - the matchday row already supports dependents; this lets the
 * provisional assignment (made before the request is closed into
 * matchdays) point at a `dependent` too.
 *
 * `member_id` stays nullable (the ad-hoc guest path already uses it
 * NULL alongside a free-text player_name); `dependent_id` is the
 * alternative target, "at most one set" by convention as on
 * matchday_player. The existing partial unique index keeps one member
 * per fixture; a new one keeps one dependent per fixture.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE availability_assignment
      ADD COLUMN dependent_id TEXT REFERENCES dependent(id)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_availability_assignment_dependent_fixture
    ON availability_assignment (availability_fixture_id, dependent_id)
    WHERE dependent_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_availability_assignment_dependent_fixture`.execute(
    db,
  );
  await sql`
    ALTER TABLE availability_assignment DROP COLUMN IF EXISTS dependent_id
  `.execute(db);
}
