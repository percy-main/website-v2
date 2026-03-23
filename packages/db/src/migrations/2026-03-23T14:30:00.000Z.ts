import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday")
    .addColumn("result_type", "text")
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("result_confirmed_at", "text")
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("result_confirmed_by", "text", (col) =>
      col.references("user.id"),
    )
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("result_source", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("matchday").dropColumn("result_type").execute();

  await db.schema
    .alterTable("matchday")
    .dropColumn("result_confirmed_at")
    .execute();

  await db.schema
    .alterTable("matchday")
    .dropColumn("result_confirmed_by")
    .execute();

  await db.schema.alterTable("matchday").dropColumn("result_source").execute();
}
