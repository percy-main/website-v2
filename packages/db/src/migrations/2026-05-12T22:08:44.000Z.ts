import { type Kysely } from "kysely";

/**
 * Scope an availability request to a user group at creation time.
 *
 * The column is nullable: existing requests (and any future request
 * that wants the whole-club audience) leave it NULL, which downstream
 * filters treat as "no group scope — all members". When set,
 *
 *   - the member dashboard / `getActiveRequests` only surfaces the
 *     request to members of that group,
 *   - the team-picking roster / `getDateDetail` filters available /
 *     unavailable / no-response pools to group members,
 *   - the notify-recipient query inherits the same join.
 *
 * ON DELETE SET NULL — deleting the group reverts the request to
 * club-wide scope rather than cascade-deleting in-flight requests.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("availability_request")
    .addColumn("user_group_id", "text", (col) =>
      col.references("user_group.id").onDelete("set null"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("availability_request")
    .dropColumn("user_group_id")
    .execute();
}
