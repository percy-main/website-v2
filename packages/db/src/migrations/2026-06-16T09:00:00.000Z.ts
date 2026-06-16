import { type Kysely, sql } from "kysely";

/**
 * Let a parent answer matchday availability on behalf of a junior
 * dependent, so that junior can be considered for selection into a
 * SENIOR squad (juniors playing up).
 *
 * `availability_response.member_id` already records a member's own
 * answer. `dependent_id` is the alternative subject - a child
 * registered under a parent `member`, with no `member` row of their
 * own. Exactly one of (member_id, dependent_id) is set per row.
 *
 * The original `UNIQUE (availability_request_id, member_id, match_date)`
 * still holds for member answers; dependent rows have member_id NULL
 * (NULLs are distinct in Postgres) so they never collide with it. A
 * matching partial unique index enforces one answer per dependent per
 * date per request.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE availability_response
      ALTER COLUMN member_id DROP NOT NULL,
      ADD COLUMN dependent_id TEXT REFERENCES dependent(id)
  `.execute(db);

  await sql`
    ALTER TABLE availability_response
      ADD CONSTRAINT availability_response_subject_check
        CHECK (num_nonnulls(member_id, dependent_id) = 1)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_availability_response_dependent_unique
    ON availability_response (availability_request_id, dependent_id, match_date)
    WHERE dependent_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_availability_response_dependent
    ON availability_response (dependent_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_availability_response_dependent`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_availability_response_dependent_unique`.execute(
    db,
  );
  await sql`
    ALTER TABLE availability_response
      DROP CONSTRAINT IF EXISTS availability_response_subject_check,
      DROP COLUMN IF EXISTS dependent_id,
      ALTER COLUMN member_id SET NOT NULL
  `.execute(db);
}
