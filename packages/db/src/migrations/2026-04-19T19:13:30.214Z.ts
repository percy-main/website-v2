import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE matchday_player
    ADD COLUMN is_captain BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN is_wicketkeeper BOOLEAN NOT NULL DEFAULT FALSE
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX matchday_player_one_captain
      ON matchday_player (matchday_id)
      WHERE is_captain
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX matchday_player_one_wicketkeeper
      ON matchday_player (matchday_id)
      WHERE is_wicketkeeper
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS matchday_player_one_wicketkeeper`.execute(db);
  await sql`DROP INDEX IF EXISTS matchday_player_one_captain`.execute(db);
  await sql`
    ALTER TABLE matchday_player
    DROP COLUMN is_wicketkeeper,
    DROP COLUMN is_captain
  `.execute(db);
}
