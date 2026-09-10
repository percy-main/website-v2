import { type Kysely, sql } from "kysely";

/** Allow an administrator to acknowledge a vanished player as a confirmed departure. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE fantasy_player
    ADD COLUMN departure_confirmed BOOLEAN NOT NULL DEFAULT false
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE fantasy_player DROP COLUMN departure_confirmed`.execute(
    db,
  );
}
