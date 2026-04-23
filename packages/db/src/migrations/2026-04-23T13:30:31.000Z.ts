import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE game_sponsorship
    ADD COLUMN sponsor_phone TEXT
  `.execute(db);

  await sql`
    ALTER TABLE player_sponsorship
    ADD COLUMN sponsor_phone TEXT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE player_sponsorship DROP COLUMN sponsor_phone`.execute(
    db,
  );
  await sql`ALTER TABLE game_sponsorship DROP COLUMN sponsor_phone`.execute(db);
}
