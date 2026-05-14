import { sql, type Kysely } from "kysely";

/**
 * Allow guest matchday players to be inserted without an email.
 *
 * The `member.email` column was `NOT NULL` with a flat unique index, and
 * the only way the matchday-officials flow could record an ad-hoc player
 * was to insert a guest member with `email = ""`. The second guest add
 * collided with `member_email_unique`.
 *
 * Make `email` nullable, backfill the existing empty-string sentinel
 * values to `NULL`, and recreate the uniqueness guarantee as a partial
 * index so real members are still deduplicated by email while any
 * number of email-less guest rows are allowed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("member_email_unique").execute();

  await db.schema
    .alterTable("member")
    .alterColumn("email", (col) => col.dropNotNull())
    .execute();

  // Replace empty-string sentinels in nullable text fields with NULL so
  // the column semantics match the rest of the project (CLAUDE.md: never
  // use "" for "no value").
  await sql`UPDATE "member" SET email = NULL WHERE email = ''`.execute(db);
  await sql`UPDATE "member" SET title = NULL WHERE title = ''`.execute(db);
  await sql`UPDATE "member" SET address = NULL WHERE address = ''`.execute(db);
  await sql`UPDATE "member" SET postcode = NULL WHERE postcode = ''`.execute(
    db,
  );
  await sql`UPDATE "member" SET dob = NULL WHERE dob = ''`.execute(db);
  await sql`UPDATE "member" SET telephone = NULL WHERE telephone = ''`.execute(
    db,
  );
  await sql`UPDATE "member" SET emergency_contact_name = NULL WHERE emergency_contact_name = ''`.execute(
    db,
  );
  await sql`UPDATE "member" SET emergency_contact_telephone = NULL WHERE emergency_contact_telephone = ''`.execute(
    db,
  );

  await sql`
    CREATE UNIQUE INDEX member_email_unique
    ON "member" (email)
    WHERE email IS NOT NULL
  `.execute(db);
}

export function down(_db: Kysely<unknown>): Promise<void> {
  // Intentionally irreversible. Once guest matchday players have been
  // added with email IS NULL, rolling back to NOT NULL + flat unique
  // would either:
  //   - reintroduce the `""` sentinel CLAUDE.md bans, or
  //   - collide on `member_email_unique` the moment >1 guest exists.
  // Forward fixes only. If a rollback is genuinely needed, hand-merge
  // the affected guest rows first.
  return Promise.reject(
    new Error(
      "Migration 2026-05-14T12:49:40.750Z is one-way: guests rely on NULL emails",
    ),
  );
}
