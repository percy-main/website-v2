import { type Kysely, sql } from "kysely";

// Matchday push notifications: per-user channel preference + per-device push
// subscription store.
//
// notification_preferences keys 1:1 on user_id and currently holds a single
// "matchday_channel" enum (email|push|both). Lives in its own table to keep
// better-auth's user row untouched and leave room for per-category prefs.
//
// push_subscription holds the Web Push endpoint + key material returned by
// PushManager.subscribe() in the browser. One row per device per user.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("notification_preferences")
    .addColumn("user_id", "text", (col) =>
      col.primaryKey().references("user.id").onDelete("cascade"),
    )
    .addColumn("matchday_channel", "text", (col) =>
      col.notNull().defaultTo("email"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "notification_preferences_matchday_channel_check",
      sql`matchday_channel IN ('email','push','both')`,
    )
    .execute();

  await db.schema
    .createTable("push_subscription")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("endpoint", "text", (col) => col.notNull().unique())
    .addColumn("p256dh", "text", (col) => col.notNull())
    .addColumn("auth", "text", (col) => col.notNull())
    .addColumn("user_agent", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("push_subscription_user_id_idx")
    .on("push_subscription")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("push_subscription").execute();
  await db.schema.dropTable("notification_preferences").execute();
}
