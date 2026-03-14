import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // =========================================================================
  // Better-auth tables (raw SQL — camelCase columns need quoting)
  // =========================================================================

  await sql`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL,
      "twoFactorEnabled" BOOLEAN,
      role TEXT,
      banned BOOLEAN,
      "banReason" TEXT,
      "banExpires" TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMP NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      "impersonatedBy" TEXT
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_session_user ON session ("userId")
  `.execute(db);

  await sql`
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMP,
      "refreshTokenExpiresAt" TIMESTAMP,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    )
  `.execute(db);

  await sql`
    CREATE TABLE verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE passkey (
      id TEXT PRIMARY KEY,
      name TEXT,
      "publicKey" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      "credentialID" TEXT NOT NULL,
      counter INTEGER NOT NULL,
      "deviceType" TEXT NOT NULL,
      "backedUp" BOOLEAN NOT NULL,
      transports TEXT,
      "createdAt" TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE "twoFactor" (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      "backupCodes" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id)
    )
  `.execute(db);

  // =========================================================================
  // Application tables (Kysely schema builder)
  // =========================================================================

  // -- member --
  await db.schema
    .createTable("member")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("title", "text")
    .addColumn("name", "text")
    .addColumn("address", "text")
    .addColumn("postcode", "text")
    .addColumn("dob", "text")
    .addColumn("telephone", "text")
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("emergency_contact_name", "text")
    .addColumn("emergency_contact_telephone", "text")
    .addColumn("stripe_customer_id", "text")
    .addColumn("play_cricket_id", "text")
    .addColumn("contentful_entry_id", "text")
    .addColumn("member_category", "text")
    .addColumn("deleted_at", "text")
    .addColumn("deleted_by", "text")
    .addColumn("deleted_reason", "text")
    .execute();

  await db.schema
    .createIndex("member_email_unique")
    .on("member")
    .column("email")
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_member_contentful_entry")
    .on("member")
    .column("contentful_entry_id")
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_member_play_cricket_id
    ON member (play_cricket_id)
    WHERE play_cricket_id IS NOT NULL
  `.execute(db);

  // -- membership --
  await db.schema
    .createTable("membership")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id"),
    )
    .addColumn("paid_until", "text", (col) => col.notNull())
    .addColumn("type", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("dependent_id", "text")
    .execute();

  await db.schema
    .createIndex("idx_membership_member")
    .on("membership")
    .column("member_id")
    .execute();

  // -- dependent --
  await db.schema
    .createTable("dependent")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id"),
    )
    .addColumn("user_id", "text", (col) => col.references("user.id"))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("sex", "text", (col) => col.notNull())
    .addColumn("dob", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("school_year", "text")
    .addColumn("played_before", "boolean")
    .addColumn("previous_cricket", "text")
    .addColumn("whatsapp_consent", "boolean")
    .addColumn("alt_contact_name", "text")
    .addColumn("alt_contact_phone", "text")
    .addColumn("alt_contact_whatsapp_consent", "boolean")
    .addColumn("gp_surgery", "text")
    .addColumn("gp_phone", "text")
    .addColumn("has_disability", "boolean")
    .addColumn("disability_type", "text")
    .addColumn("medical_info", "text")
    .addColumn("emergency_medical_consent", "boolean")
    .addColumn("medical_fitness_declaration", "boolean")
    .addColumn("data_protection_consent", "boolean")
    .addColumn("photo_consent", "boolean")
    .addColumn("play_cricket_id", "text")
    .execute();

  await db.schema
    .createIndex("idx_dependent_member")
    .on("dependent")
    .column("member_id")
    .execute();

  // -- charge --
  await db.schema
    .createTable("charge")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("member_id", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("charge_date", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("paid_at", "text")
    .addColumn("stripe_payment_intent_id", "text")
    .addColumn("created_by", "text", (col) => col.notNull())
    .addColumn("deleted_at", "text")
    .addColumn("deleted_by", "text")
    .addColumn("deleted_reason", "text")
    .addColumn("payment_confirmed_at", "text")
    .addColumn("type", "text", (col) => col.notNull().defaultTo("manual"))
    .addColumn("source", "text", (col) => col.notNull().defaultTo("admin"))
    .addColumn("payment_method", "text")
    .execute();

  await db.schema
    .createIndex("idx_charge_member")
    .on("charge")
    .column("member_id")
    .execute();

  await db.schema
    .createIndex("idx_charge_stripe_pi")
    .on("charge")
    .column("stripe_payment_intent_id")
    .execute();

  // -- charge_dependent --
  await db.schema
    .createTable("charge_dependent")
    .addColumn("charge_id", "text", (col) =>
      col.notNull().references("charge.id"),
    )
    .addColumn("dependent_id", "text", (col) =>
      col.notNull().references("dependent.id"),
    )
    .addPrimaryKeyConstraint("charge_dependent_pkey", [
      "charge_id",
      "dependent_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_charge_dependent_charge")
    .on("charge_dependent")
    .column("charge_id")
    .execute();

  await db.schema
    .createIndex("idx_charge_dependent_dependent")
    .on("charge_dependent")
    .column("dependent_id")
    .execute();

  // -- event_subscriber --
  await db.schema
    .createTable("event_subscriber")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("meta", "jsonb", (col) => col.notNull())
    .execute();

  // -- game_score --
  await db.schema
    .createTable("game_score")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("game", "text", (col) =>
      col.notNull().defaultTo("be-the-keeper"),
    )
    .addColumn("score", "integer", (col) => col.notNull())
    .addColumn("level", "integer", (col) => col.notNull())
    .addColumn("catches", "integer", (col) => col.notNull())
    .addColumn("best_streak", "integer", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addUniqueConstraint("game_score_user_game_unique", ["user_id", "game"])
    .execute();

  await db.schema
    .createIndex("idx_game_score_user_game")
    .on("game_score")
    .columns(["user_id", "game"])
    .execute();

  await sql`
    CREATE INDEX idx_game_score_leaderboard ON game_score (game, score DESC)
  `.execute(db);

  // -- contact_submission --
  await db.schema
    .createTable("contact_submission")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("message", "text", (col) => col.notNull())
    .addColumn("page", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // -- game_sponsorship --
  await db.schema
    .createTable("game_sponsorship")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("game_id", "text", (col) => col.notNull())
    .addColumn("stripe_payment_intent_id", "text")
    .addColumn("paid_at", "text")
    .addColumn("sponsor_name", "text", (col) => col.notNull())
    .addColumn("sponsor_email", "text", (col) => col.notNull())
    .addColumn("sponsor_website", "text")
    .addColumn("sponsor_logo_url", "text")
    .addColumn("sponsor_message", "text")
    .addColumn("approved", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("display_name", "text")
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("notes", "text")
    .execute();

  await db.schema
    .createIndex("idx_game_sponsorship_game")
    .on("game_sponsorship")
    .column("game_id")
    .execute();

  await db.schema
    .createIndex("idx_game_sponsorship_created")
    .on("game_sponsorship")
    .column("created_at")
    .execute();

  // -- junior_team --
  await db.schema
    .createTable("junior_team")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("age_group", "text", (col) => col.notNull())
    .addColumn("sex", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // -- junior_team_manager --
  await db.schema
    .createTable("junior_team_manager")
    .addColumn("user_id", "text", (col) => col.notNull().references("user.id"))
    .addColumn("junior_team_id", "text", (col) =>
      col.notNull().references("junior_team.id"),
    )
    .addPrimaryKeyConstraint("junior_team_manager_pkey", [
      "user_id",
      "junior_team_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_junior_team_mgr_user")
    .on("junior_team_manager")
    .column("user_id")
    .execute();

  // -- play_cricket_team --
  await db.schema
    .createTable("play_cricket_team")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("is_junior", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("site_id", "text", (col) => col.notNull())
    .addColumn("last_updated", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // -- match_performance_batting --
  await db.schema
    .createTable("match_performance_batting")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("match_id", "text", (col) => col.notNull())
    .addColumn("player_id", "text", (col) => col.notNull())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("team_id", "text", (col) => col.notNull())
    .addColumn("competition_type", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("match_date", "text", (col) => col.notNull())
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("runs", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("balls", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("fours", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("sixes", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("how_out", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("not_out", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("match_performance_batting_match_player_unique", [
      "match_id",
      "player_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_batting_season_team")
    .on("match_performance_batting")
    .columns(["season", "team_id", "competition_type"])
    .execute();

  await db.schema
    .createIndex("idx_batting_player")
    .on("match_performance_batting")
    .column("player_id")
    .execute();

  // -- match_performance_bowling --
  await db.schema
    .createTable("match_performance_bowling")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("match_id", "text", (col) => col.notNull())
    .addColumn("player_id", "text", (col) => col.notNull())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("team_id", "text", (col) => col.notNull())
    .addColumn("competition_type", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("match_date", "text", (col) => col.notNull())
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("overs", "text", (col) => col.notNull().defaultTo("0"))
    .addColumn("maidens", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("runs", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("wickets", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("wides", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("no_balls", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("match_performance_bowling_match_player_unique", [
      "match_id",
      "player_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_bowling_season_team")
    .on("match_performance_bowling")
    .columns(["season", "team_id", "competition_type"])
    .execute();

  await db.schema
    .createIndex("idx_bowling_player")
    .on("match_performance_bowling")
    .column("player_id")
    .execute();

  // -- match_performance_fielding --
  await db.schema
    .createTable("match_performance_fielding")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("match_id", "text", (col) => col.notNull())
    .addColumn("player_id", "text", (col) => col.notNull())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("team_id", "text", (col) => col.notNull())
    .addColumn("competition_type", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("match_date", "text", (col) => col.notNull())
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("catches", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("run_outs", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("stumpings", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("is_wicketkeeper", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("match_performance_fielding_match_player_unique", [
      "match_id",
      "player_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_fielding_season_team")
    .on("match_performance_fielding")
    .columns(["season", "team_id", "competition_type"])
    .execute();

  await db.schema
    .createIndex("idx_fielding_player")
    .on("match_performance_fielding")
    .column("player_id")
    .execute();

  // -- match_result --
  await db.schema
    .createTable("match_result")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("match_id", "text", (col) => col.notNull().unique())
    .addColumn("home_team_id", "text", (col) => col.notNull())
    .addColumn("away_team_id", "text", (col) => col.notNull())
    .addColumn("home_team_name", "text", (col) => col.notNull())
    .addColumn("away_team_name", "text", (col) => col.notNull())
    .addColumn("result", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("result_description", "text", (col) =>
      col.notNull().defaultTo(""),
    )
    .addColumn("result_applied_to", "text", (col) =>
      col.notNull().defaultTo(""),
    )
    .addColumn("competition_type", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("match_date", "text", (col) => col.notNull())
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // -- play_cricket_sync_log --
  await db.schema
    .createTable("play_cricket_sync_log")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("completed_at", "text")
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("matches_processed", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("errors", "text")
    .execute();

  // -- play_cricket_match_cache --
  await db.schema
    .createTable("play_cricket_match_cache")
    .addColumn("match_id", "text", (col) => col.primaryKey())
    .addColumn("data", "text", (col) => col.notNull())
    .addColumn("fetched_at", "text", (col) => col.notNull())
    .addColumn("match_date", "text", (col) => col.notNull())
    .execute();

  // -- player_sponsorship --
  await db.schema
    .createTable("player_sponsorship")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("contentful_entry_id", "text", (col) => col.notNull())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("season", "integer", (col) => col.notNull())
    .addColumn("stripe_payment_intent_id", "text")
    .addColumn("paid_at", "text")
    .addColumn("sponsor_name", "text", (col) => col.notNull())
    .addColumn("sponsor_email", "text", (col) => col.notNull())
    .addColumn("sponsor_website", "text")
    .addColumn("sponsor_logo_url", "text")
    .addColumn("sponsor_message", "text")
    .addColumn("approved", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("display_name", "text")
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("notes", "text")
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_player_sponsorship_unique_paid
    ON player_sponsorship (contentful_entry_id, season)
    WHERE paid_at IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex("idx_player_sponsorship_lookup")
    .on("player_sponsorship")
    .columns(["contentful_entry_id", "season"])
    .execute();

  await db.schema
    .createIndex("idx_player_sponsorship_created")
    .on("player_sponsorship")
    .column("created_at")
    .execute();

  // -- team_official --
  await db.schema
    .createTable("team_official")
    .addColumn("user_id", "text", (col) => col.notNull().references("user.id"))
    .addColumn("play_cricket_team_id", "text", (col) =>
      col.notNull().references("play_cricket_team.id"),
    )
    .addPrimaryKeyConstraint("team_official_pkey", [
      "user_id",
      "play_cricket_team_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_team_official_user")
    .on("team_official")
    .column("user_id")
    .execute();

  // -- matchday --
  await db.schema
    .createTable("matchday")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("play_cricket_team_id", "text", (col) =>
      col.notNull().references("play_cricket_team.id"),
    )
    .addColumn("match_date", "text", (col) => col.notNull())
    .addColumn("opposition", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("confirmed_at", "text")
    .addColumn("confirmed_by", "text", (col) => col.references("user.id"))
    .addColumn("finished_at", "text")
    .addColumn("finished_by", "text", (col) => col.references("user.id"))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("created_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("competition_type", "text")
    .addColumn("play_cricket_match_id", "text")
    .execute();

  await db.schema
    .createIndex("idx_matchday_team_date")
    .on("matchday")
    .columns(["play_cricket_team_id", "match_date"])
    .execute();

  await db.schema
    .createIndex("idx_matchday_status")
    .on("matchday")
    .column("status")
    .execute();

  // -- matchday_player --
  await db.schema
    .createTable("matchday_player")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("matchday_id", "text", (col) =>
      col.notNull().references("matchday.id"),
    )
    .addColumn("member_id", "text", (col) => col.references("member.id"))
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("selected"))
    .addColumn("replaced_by_matchday_player_id", "text", (col) =>
      col.references("matchday_player.id"),
    )
    .addColumn("charge_id", "text", (col) => col.references("charge.id"))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("idx_matchday_player_matchday")
    .on("matchday_player")
    .column("matchday_id")
    .execute();

  await db.schema
    .createIndex("idx_matchday_player_member")
    .on("matchday_player")
    .column("member_id")
    .execute();

  // -- match_fee_rate --
  await db.schema
    .createTable("match_fee_rate")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("play_cricket_team_id", "text", (col) =>
      col.references("play_cricket_team.id"),
    )
    .addColumn("competition_type", "text")
    .addColumn("member_category", "text", (col) => col.notNull())
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("idx_match_fee_rate_lookup")
    .on("match_fee_rate")
    .columns(["play_cricket_team_id", "competition_type", "member_category"])
    .execute();

  // -- matchday_expense --
  await db.schema
    .createTable("matchday_expense")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("matchday_id", "text", (col) =>
      col.notNull().references("matchday.id"),
    )
    .addColumn("expense_type", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("created_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("receipt_image_url", "text")
    .execute();

  // -- fantasy_player --
  await db.schema
    .createTable("fantasy_player")
    .addColumn("play_cricket_id", "text", (col) => col.primaryKey())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("eligible", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("sandwich_cost", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("idx_fantasy_player_eligible")
    .on("fantasy_player")
    .column("eligible")
    .execute();

  // -- fantasy_team --
  await db.schema
    .createTable("fantasy_team")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("season", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("fantasy_team_user_season_unique", [
      "user_id",
      "season",
    ])
    .execute();

  // -- fantasy_team_player --
  await db.schema
    .createTable("fantasy_team_player")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("fantasy_team_id", "integer", (col) =>
      col.notNull().references("fantasy_team.id"),
    )
    .addColumn("play_cricket_id", "text", (col) =>
      col.notNull().references("fantasy_player.play_cricket_id"),
    )
    .addColumn("is_captain", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("gameweek_added", "integer", (col) => col.notNull())
    .addColumn("gameweek_removed", "integer")
    .addColumn("slot_type", "text", (col) => col.notNull().defaultTo("batting"))
    .addColumn("is_wicketkeeper", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  await db.schema
    .createIndex("idx_ftp_team")
    .on("fantasy_team_player")
    .column("fantasy_team_id")
    .execute();

  await db.schema
    .createIndex("idx_ftp_player")
    .on("fantasy_team_player")
    .column("play_cricket_id")
    .execute();

  // -- fantasy_player_score --
  await db.schema
    .createTable("fantasy_player_score")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("gameweek_id", "integer", (col) => col.notNull())
    .addColumn("play_cricket_id", "text", (col) => col.notNull())
    .addColumn("match_id", "text", (col) => col.notNull())
    .addColumn("batting_points", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("bowling_points", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("fielding_points", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("team_points", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("total_points", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("season", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("catches", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("is_actual_keeper", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("stumpings", "integer", (col) => col.notNull().defaultTo(0))
    .addUniqueConstraint("fantasy_player_score_unique", [
      "season",
      "gameweek_id",
      "play_cricket_id",
      "match_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_fps_play_cricket_id")
    .on("fantasy_player_score")
    .column("play_cricket_id")
    .execute();

  // -- fantasy_team_score --
  await db.schema
    .createTable("fantasy_team_score")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("gameweek_id", "integer", (col) => col.notNull())
    .addColumn("fantasy_team_id", "integer", (col) =>
      col.notNull().references("fantasy_team.id"),
    )
    .addColumn("total_points", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("season", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("fantasy_team_score_unique", [
      "season",
      "gameweek_id",
      "fantasy_team_id",
    ])
    .execute();

  // -- fantasy_chip_usage --
  await db.schema
    .createTable("fantasy_chip_usage")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("fantasy_team_id", "integer", (col) =>
      col.notNull().references("fantasy_team.id"),
    )
    .addColumn("chip_type", "text", (col) => col.notNull())
    .addColumn("gameweek_id", "integer", (col) => col.notNull())
    .addColumn("season", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("fantasy_chip_usage_unique", [
      "fantasy_team_id",
      "chip_type",
      "gameweek_id",
    ])
    .execute();

  await db.schema
    .createIndex("idx_fcu_team_season")
    .on("fantasy_chip_usage")
    .columns(["fantasy_team_id", "season"])
    .execute();

  // -- fantasy_chaos_week --
  await db.schema
    .createTable("fantasy_chaos_week")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("season", "text", (col) => col.notNull())
    .addColumn("gameweek_id", "integer", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("rule_type", "text", (col) => col.notNull())
    .addColumn("rule_config", "text", (col) => col.notNull().defaultTo("{}"))
    .addColumn("send_email", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("email_sent", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("fantasy_chaos_week_season_gameweek_unique", [
      "season",
      "gameweek_id",
    ])
    .execute();

  // =========================================================================
  // Seed data
  // =========================================================================

  await db
    .insertInto("junior_team" as never)
    .values([
      { id: "u11-boys", name: "U11 Boys", age_group: "U11", sex: "male" },
      { id: "u11-girls", name: "U11 Girls", age_group: "U11", sex: "female" },
      { id: "u13-boys", name: "U13 Boys", age_group: "U13", sex: "male" },
      { id: "u13-girls", name: "U13 Girls", age_group: "U13", sex: "female" },
      { id: "u15-boys", name: "U15 Boys", age_group: "U15", sex: "male" },
      { id: "u15-girls", name: "U15 Girls", age_group: "U15", sex: "female" },
      { id: "u19-boys", name: "U19 Boys", age_group: "U19", sex: "male" },
      { id: "u19-girls", name: "U19 Girls", age_group: "U19", sex: "female" },
    ] as never)
    .execute();
}
