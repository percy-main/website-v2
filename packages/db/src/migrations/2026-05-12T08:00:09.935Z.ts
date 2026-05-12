import { sql, type Kysely } from "kysely";

/**
 * Backfill `member` rows for users that registered before the
 * signup→member auto-link hook existed.
 *
 * The hook (apps/api/src/features/auth/auth.ts databaseHooks.user.create.after)
 * inserts a paired `member` row at user-create time. Anyone who
 * registered prior to that change has a `user` but no `member`, so
 * downstream lookups (financial relief eligible-members,
 * matchday/charge attribution, etc.) come up empty for those legacy
 * accounts. This migration creates a 1:1 catch-up row for each.
 *
 * Idempotent via the LEFT JOIN exclusion: re-running this would be a
 * no-op because all eligible users now have a member.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO member (id, email, name)
    SELECT
      gen_random_uuid()::text,
      u.email,
      u.name
    FROM "user" u
    LEFT JOIN member m ON m.email = u.email
    WHERE m.id IS NULL
      AND u.email IS NOT NULL
  `.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // No safe rollback: we can't distinguish backfilled rows from rows
  // an admin created manually. Treat this as a one-way data fix.
}
