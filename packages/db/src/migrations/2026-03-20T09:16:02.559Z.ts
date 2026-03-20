import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // --- member table: drop contentful_entry_id, add slug ---

  // Drop the index on contentful_entry_id
  await db.schema.dropIndex("idx_member_contentful_entry").execute();

  // Drop the column
  await db.schema
    .alterTable("member")
    .dropColumn("contentful_entry_id")
    .execute();

  // Add nullable slug column
  await db.schema.alterTable("member").addColumn("slug", "text").execute();

  // Add unique index on slug where not null
  await sql`
    CREATE UNIQUE INDEX idx_member_slug
    ON member (slug)
    WHERE slug IS NOT NULL
  `.execute(db);

  // --- player_sponsorship table: drop contentful_entry_id, add slug ---

  // Drop unique paid index
  await db.schema.dropIndex("idx_player_sponsorship_unique_paid").execute();

  // Drop lookup index
  await db.schema.dropIndex("idx_player_sponsorship_lookup").execute();

  // Drop contentful_entry_id (was NOT NULL — drop and replace with slug)
  await db.schema
    .alterTable("player_sponsorship")
    .dropColumn("contentful_entry_id")
    .execute();

  // Add nullable slug column
  await db.schema
    .alterTable("player_sponsorship")
    .addColumn("slug", "text")
    .execute();

  // Recreate indexes using slug
  await sql`
    CREATE UNIQUE INDEX idx_player_sponsorship_unique_paid
    ON player_sponsorship (slug, season)
    WHERE paid_at IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex("idx_player_sponsorship_lookup")
    .on("player_sponsorship")
    .columns(["slug", "season"])
    .execute();
}
