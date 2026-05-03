import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── scout_thread: persisted analyst chat threads owned by a user ──
  await db.schema
    .createTable("scout_thread")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await sql`CREATE INDEX scout_thread_user_updated_idx ON scout_thread (user_id, updated_at DESC)`.execute(
    db,
  );

  // ── scout_message: AI SDK UIMessage parts persisted per turn ──
  await db.schema
    .createTable("scout_message")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("thread_id", "uuid", (col) =>
      col.notNull().references("scout_thread.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("parts", "jsonb", (col) => col.notNull())
    .addColumn("token_input", "integer")
    .addColumn("token_output", "integer")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "scout_message_role_check",
      sql`role IN ('user','assistant','tool','system')`,
    )
    .execute();

  await db.schema
    .createIndex("scout_message_thread_created_idx")
    .on("scout_message")
    .columns(["thread_id", "created_at"])
    .execute();

  // ── scout_tool_cache: TTL'd cache for Play Cricket API tool results ──
  await db.schema
    .createTable("scout_tool_cache")
    .addColumn("cache_key", "text", (col) => col.primaryKey())
    .addColumn("tool_name", "text", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("scout_tool_cache_expires_idx")
    .on("scout_tool_cache")
    .column("expires_at")
    .execute();

  // ── scout_member view: redacted, soft-delete-filtered, joined to membership ──
  // The single redaction boundary for Scout's view of members. New columns
  // added to `member` do not leak through this view. `dependent_id IS NULL`
  // restricts the membership rollup to memberships paid for the member
  // themselves, not their dependents.
  await sql`
    CREATE VIEW scout_member AS
    SELECT
      m.id,
      m.name,
      m.dob,
      m.member_category,
      m.slug,
      m.play_cricket_id,
      ms.first_membership_at,
      ms.latest_paid_until,
      ms.membership_count
    FROM member m
    LEFT JOIN (
      SELECT
        member_id,
        MIN(created_at) AS first_membership_at,
        MAX(paid_until) AS latest_paid_until,
        COUNT(*)        AS membership_count
      FROM membership
      WHERE dependent_id IS NULL
      GROUP BY member_id
    ) ms ON ms.member_id = m.id
    WHERE m.deleted_at IS NULL
  `.execute(db);

  // ── scout_readonly role ──
  // NOLOGIN: password and LOGIN attribute are set out-of-band per environment
  // (Terraform/Secrets Manager in prod, dev setup script locally) so credentials
  // never enter the migration history.
  await sql`CREATE ROLE scout_readonly NOLOGIN`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO scout_readonly`.execute(db);
  await sql`GRANT SELECT ON
    matchday,
    matchday_player,
    match_result,
    match_performance_batting,
    match_performance_bowling,
    match_performance_fielding,
    play_cricket_match_cache,
    play_cricket_team,
    play_cricket_sync_log,
    availability_fixture,
    availability_request,
    availability_response,
    availability_assignment,
    scout_member
  TO scout_readonly`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL ON
    matchday, matchday_player, match_result,
    match_performance_batting, match_performance_bowling, match_performance_fielding,
    play_cricket_match_cache, play_cricket_team, play_cricket_sync_log,
    availability_fixture, availability_request, availability_response, availability_assignment,
    scout_member
  FROM scout_readonly`.execute(db);
  await sql`REVOKE USAGE ON SCHEMA public FROM scout_readonly`.execute(db);
  await sql`DROP ROLE scout_readonly`.execute(db);
  await sql`DROP VIEW scout_member`.execute(db);
  await db.schema.dropTable("scout_tool_cache").execute();
  await db.schema.dropTable("scout_message").execute();
  await db.schema.dropTable("scout_thread").execute();
}
