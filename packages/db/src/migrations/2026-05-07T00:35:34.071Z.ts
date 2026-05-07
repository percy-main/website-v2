import { type Kysely, sql } from "kysely";

/**
 * ResultsVault ball-by-ball + match-stream ingest tables.
 *
 *   rv_player_mapping  — bridge from RV's numeric player_id to PC's
 *                        external_id (which lines up with member.play_cricket_id).
 *                        Populated from MatchTeams[].Innings[].PlayerPerfs[]
 *                        on every overview fetch — every player we see across
 *                        any of our matches lands here, including opposition.
 *
 *   match_stream       — one row per match recording (Frogbox stream → YouTube).
 *                        Sparse: only matches whose ground had a camera get rows.
 *
 *   match_ball         — one row per delivery (legal + illegal). The bulk of
 *                        the data. Player ids stored as RV ints; resolve to
 *                        PC via rv_player_mapping when joining to member.
 *
 * Player ids on match_ball are RV-native (int) rather than PC-native (text)
 * for two reasons: (1) the BBB feed gives RV ids, so storing those keeps
 * the write path lossless and the unique constraint stable; (2) the player
 * mapping can lag if a player appears in BBB before their PlayerPerf row is
 * written (e.g. a partial overview fetch) — we don't want to drop ball rows
 * when the mapping isn't ready yet.
 *
 * No ON DELETE CASCADE from match_result → these tables: ball / stream
 * deletion is rare enough to do explicitly. But we do FK to match_result so
 * an orphan match_ball row can't be written.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // -- rv_player_mapping --
  await db.schema
    .createTable("rv_player_mapping")
    .addColumn("rv_player_id", "integer", (col) => col.primaryKey())
    .addColumn("pc_player_id", "text", (col) => col.notNull())
    .addColumn("player_name", "text", (col) => col.notNull())
    .addColumn("last_seen_match_date", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // Lookup by PC id — resolving "all RV ids that ever mapped to this player"
  // (rare but the player_career view eventually wants it).
  await db.schema
    .createIndex("rv_player_mapping_pc_player_id_idx")
    .on("rv_player_mapping")
    .column("pc_player_id")
    .execute();

  // -- match_stream --
  await db.schema
    .createTable("match_stream")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("match_id", "text", (col) =>
      col.notNull().references("match_result.match_id"),
    )
    .addColumn("rv_match_id", "text", (col) => col.notNull())
    .addColumn("rv_stream_id", "integer", (col) => col.notNull().unique())
    .addColumn("video_id", "text", (col) => col.notNull())
    .addColumn("frogbox_stream_id", "text", (col) => col.notNull())
    .addColumn("stream_provider_id", "integer", (col) => col.notNull())
    .addColumn("start_utc", "timestamptz")
    .addColumn("recording_started_utc", "timestamptz")
    .addColumn("publish_status_id", "integer")
    .addColumn("description", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("match_stream_match_id_idx")
    .on("match_stream")
    .column("match_id")
    .execute();

  // -- match_ball --
  await db.schema
    .createTable("match_ball")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Match identity
    .addColumn("match_id", "text", (col) =>
      col.notNull().references("match_result.match_id"),
    )
    .addColumn("rv_match_id", "text", (col) => col.notNull())
    .addColumn("rv_result_id", "text", (col) => col.notNull())
    .addColumn("innings_number", "integer", (col) => col.notNull())
    // Ball identity
    .addColumn("over_no", "integer", (col) => col.notNull())
    .addColumn("ball_no", "integer", (col) => col.notNull())
    .addColumn("ball_no_disp", "integer", (col) => col.notNull())
    // Participants — RV ids; resolve to PC via rv_player_mapping
    .addColumn("batter_rv_id", "integer")
    .addColumn("batter_ns_rv_id", "integer")
    .addColumn("bowler_rv_id", "integer")
    .addColumn("dismissed_batter_rv_id", "integer")
    // Outcome
    .addColumn("runs_bat", "integer", (col) => col.notNull())
    .addColumn("runs_extra", "integer", (col) => col.notNull())
    .addColumn("extras_type", "text")
    .addColumn("l_desc", "text", (col) => col.notNull())
    .addColumn("s_desc", "text", (col) => col.notNull())
    // Timing & video deep-link
    .addColumn("ball_time_utc", "timestamptz")
    .addColumn("ball_offset_seconds", "integer")
    // Raw event markers (boundary / wicket flags etc.) — kept as jsonb for
    // forward-compat; cheap to keep, no agreed normalisation yet.
    .addColumn("highlight_events", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    // Hawkeye-style data — all null for amateur today; persisted in case
    // future feeds populate them.
    .addColumn("ball_spot_x", sql`real`)
    .addColumn("ball_spot_y", sql`real`)
    .addColumn("shot_angle", sql`real`)
    .addColumn("shot_length", sql`real`)
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("match_ball_natural_key_uq", [
      "rv_match_id",
      "rv_result_id",
      "innings_number",
      "ball_no",
    ])
    .execute();

  // Hot path: chronological retrieval of a match's balls.
  await db.schema
    .createIndex("match_ball_match_innings_order_idx")
    .on("match_ball")
    .columns(["match_id", "innings_number", "over_no", "ball_no"])
    .execute();

  // Player-balls-this-season analytics (use case 2 — dismissal patterns).
  await db.schema
    .createIndex("match_ball_batter_idx")
    .on("match_ball")
    .columns(["batter_rv_id", "match_id", "innings_number", "ball_no"])
    .execute();

  // Bowling spell analytics — symmetric to batter index.
  await db.schema
    .createIndex("match_ball_bowler_idx")
    .on("match_ball")
    .columns(["bowler_rv_id", "match_id", "innings_number", "ball_no"])
    .execute();

  // Dismissals are rare per innings — partial index keeps the cardinality low.
  await sql`
    CREATE INDEX match_ball_dismissed_idx
    ON match_ball (dismissed_batter_rv_id)
    WHERE dismissed_batter_rv_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("match_ball").execute();
  await db.schema.dropTable("match_stream").execute();
  await db.schema.dropTable("rv_player_mapping").execute();
}
