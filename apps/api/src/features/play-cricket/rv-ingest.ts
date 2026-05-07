import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type { RvClient } from "./rv-client.ts";
import { parseMsDate } from "./rv-client.ts";
import {
  canonicaliseExtrasType,
  isUnmappedExtra,
  type RvBall,
  type RvMatchOverview,
  type RvMatchStream,
  type RvPlayerPerf,
} from "./rv-schemas.ts";

// Cap the per-team innings probe. NEPL is limited-overs (1 innings/team),
// but the sync should tolerate longer formats without us hard-coding 1.
// We stop at the first innings that returns no balls, so the cap only
// matters as a safety net.
const MAX_INNINGS_PER_TEAM = 4;

/**
 * Ingest ResultsVault ball-by-ball + match-stream data for a single match.
 *
 * Idempotent: every write is an upsert against a stable natural key, so
 * re-running this for the same match is a no-op when nothing's changed
 * and a corrective upsert when RV has fixed something post-match.
 *
 * Resolves silently (returns false) when the match has no RV-side data
 * — a 404 on the mapping endpoint, a 0 mapping result, or an overview
 * with no MatchTeams. The PC sync calls this for every processed match;
 * the "no live scoring" case is the common one and shouldn't be noisy.
 *
 * Throws on unexpected RV failures (token rejection, malformed schema,
 * etc.) so the caller's per-match try/catch logs them to the sync log.
 *
 * Returns true when at least one ball or stream row was written.
 */
export async function ingestRvDataForMatch(
  db: Kysely<DB>,
  rv: RvClient,
  pcMatchId: string,
  matchDateIso: string,
): Promise<boolean> {
  const mapping = await rv.getMatchMapping(pcMatchId);
  if (!mapping) return false;

  const overview = await rv.getMatch(mapping.rvMatchId);
  if (!overview || overview.MatchTeams.length === 0) return false;

  await upsertPlayerMappings(db, overview, matchDateIso);

  const streamRows = await upsertMatchStreams(
    db,
    overview,
    pcMatchId,
    mapping.rvMatchId,
  );

  // Anchor for ball_offset_seconds (used for YouTube deep-links). Use the
  // earliest recording_started_utc across the match's streams; if none
  // have a recording start, leave offsets null on every ball.
  const anchor = pickRecordingAnchor(overview.matchStreams);

  let ballsWritten = 0;
  for (const team of overview.MatchTeams) {
    for (let innings = 1; innings <= MAX_INNINGS_PER_TEAM; innings++) {
      const balls = await rv.getBalls(
        mapping.rvMatchId,
        team.result_id,
        innings,
      );
      if (balls.length === 0) break;
      ballsWritten += await upsertBalls(db, balls, {
        matchId: pcMatchId,
        rvMatchId: mapping.rvMatchId,
        rvResultId: String(team.result_id),
        anchorMs: anchor?.getTime() ?? null,
      });
    }
  }

  return ballsWritten > 0 || streamRows > 0;
}

async function upsertPlayerMappings(
  db: Kysely<DB>,
  overview: RvMatchOverview,
  matchDateIso: string,
): Promise<void> {
  const seen = new Map<number, RvPlayerPerf>();
  for (const team of overview.MatchTeams) {
    for (const innings of team.Innings) {
      for (const perf of innings.PlayerPerfs) {
        // Drop perfs with no PC external_id — we'd just be storing names
        // against an int with no resolve path back to our member table.
        if (!perf.external_id) continue;
        // De-dupe within a match (same player can appear in batting and
        // bowling perfs). Last-write-wins on name.
        seen.set(perf.player_id, perf);
      }
    }
  }
  if (seen.size === 0) return;

  const rows = Array.from(seen.values()).map((perf) => ({
    rv_player_id: perf.player_id,
    pc_player_id: perf.external_id ?? "",
    player_name: perf.player_name,
    last_seen_match_date: matchDateIso,
  }));

  await db
    .insertInto("rv_player_mapping")
    .values(rows)
    .onConflict((oc) =>
      oc.column("rv_player_id").doUpdateSet({
        pc_player_id: (eb) => eb.ref("excluded.pc_player_id"),
        player_name: (eb) => eb.ref("excluded.player_name"),
        // last_seen_match_date should only ever advance — backfilling an
        // older match must not move the marker backwards.
        last_seen_match_date: (eb) =>
          eb.fn("greatest", [
            eb.ref("rv_player_mapping.last_seen_match_date"),
            eb.ref("excluded.last_seen_match_date"),
          ]),
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}

async function upsertMatchStreams(
  db: Kysely<DB>,
  overview: RvMatchOverview,
  pcMatchId: string,
  rvMatchId: string,
): Promise<number> {
  if (overview.matchStreams.length === 0) return 0;

  // Streams without a video_id aren't useful — the whole point of the row
  // is to deep-link to the video. RV's schema permits empty defaults; we
  // drop those rather than persist hollow records.
  const usable = overview.matchStreams.filter(
    (s) => s.video_id.length > 0 && s.frogbox_stream_id.length > 0,
  );
  if (usable.length === 0) return 0;

  // Dedupe by rv_stream_id (the unique constraint) so a freak RV response
  // with the same id twice can't trip "cannot affect row a second time".
  const dedupedStreams = new Map<number, (typeof usable)[number]>();
  for (const s of usable) dedupedStreams.set(s.id, s);

  const rows = Array.from(dedupedStreams.values()).map((s) => ({
    match_id: pcMatchId,
    rv_match_id: rvMatchId,
    rv_stream_id: s.id,
    video_id: s.video_id,
    frogbox_stream_id: s.frogbox_stream_id,
    stream_provider_id: s.stream_provider_id,
    start_utc: parseMsDate(s.start_utc)?.toISOString() ?? null,
    recording_started_utc:
      parseMsDate(s.recording_started_utc)?.toISOString() ?? null,
    publish_status_id: s.publish_status_id ?? null,
    description: s.description ?? null,
  }));

  await db
    .insertInto("match_stream")
    .values(rows)
    .onConflict((oc) =>
      oc.column("rv_stream_id").doUpdateSet({
        match_id: (eb) => eb.ref("excluded.match_id"),
        rv_match_id: (eb) => eb.ref("excluded.rv_match_id"),
        video_id: (eb) => eb.ref("excluded.video_id"),
        frogbox_stream_id: (eb) => eb.ref("excluded.frogbox_stream_id"),
        stream_provider_id: (eb) => eb.ref("excluded.stream_provider_id"),
        start_utc: (eb) => eb.ref("excluded.start_utc"),
        recording_started_utc: (eb) => eb.ref("excluded.recording_started_utc"),
        publish_status_id: (eb) => eb.ref("excluded.publish_status_id"),
        description: (eb) => eb.ref("excluded.description"),
      }),
    )
    .execute();

  return rows.length;
}

interface UpsertBallsContext {
  matchId: string;
  rvMatchId: string;
  rvResultId: string;
  anchorMs: number | null;
}

async function upsertBalls(
  db: Kysely<DB>,
  balls: RvBall[],
  ctx: UpsertBallsContext,
): Promise<number> {
  if (balls.length === 0) return 0;

  // Dedupe within the batch on the same natural key Postgres uses for the
  // unique constraint. Postgres rejects an INSERT … ON CONFLICT DO UPDATE
  // statement that targets the same conflict row twice ("cannot affect
  // row a second time"), so even though every row in `balls` *should* be
  // unique within an innings, we collapse defensively. Last-write-wins —
  // RV occasionally emits revised rows and the latest is the corrected
  // value.
  const dedupedBalls = new Map<string, RvBall>();
  for (const b of balls) {
    const key = `${String(b.innings_number)}:${String(b.over_no)}:${String(b.ball_no)}`;
    dedupedBalls.set(key, b);
  }

  const rows = Array.from(dedupedBalls.values()).map((b) => {
    const ballTime = parseMsDate(b.ball_time);
    const offsetSeconds =
      ballTime != null && ctx.anchorMs != null
        ? Math.round((ballTime.getTime() - ctx.anchorMs) / 1000)
        : null;
    const extrasType = canonicaliseExtrasType(b.extras_type);
    if (isUnmappedExtra(b.extras_type, extrasType)) {
      // RV sent us a code we don't know about. Don't fail the ingest —
      // store null and surface a warning so we notice and add the
      // mapping. Match + ball coordinates are enough to find the row in
      // RV later for verification.
      console.warn(
        `[rv-ingest] unmapped extras_type ${JSON.stringify(b.extras_type)} on match=${ctx.matchId} innings=${String(b.innings_number)} over=${String(b.over_no)} ball=${String(b.ball_no)}`,
      );
    }
    return {
      match_id: ctx.matchId,
      rv_match_id: ctx.rvMatchId,
      rv_result_id: ctx.rvResultId,
      innings_number: b.innings_number,
      over_no: b.over_no,
      ball_no: b.ball_no,
      ball_no_disp: b.ball_no_disp,
      batter_rv_id: b.batter_id ?? null,
      batter_ns_rv_id: b.batter_id_ns ?? null,
      bowler_rv_id: b.bowler_id ?? null,
      dismissed_batter_rv_id: b.dismissed_batter_id ?? null,
      runs_bat: b.runs_bat,
      runs_extra: b.runs_extra,
      extras_type: extrasType,
      l_desc: b.l_desc,
      s_desc: b.s_desc,
      ball_time_utc: ballTime?.toISOString() ?? null,
      ball_offset_seconds: offsetSeconds,
      highlight_events: JSON.stringify(b.match_highlight_events),
      ball_spot_x: b.ball_spot_x ?? null,
      ball_spot_y: b.ball_spot_y ?? null,
      shot_angle: b.shot_angle ?? null,
      shot_length: b.shot_length ?? null,
    };
  });

  await db
    .insertInto("match_ball")
    .values(rows)
    .onConflict((oc) =>
      oc.constraint("match_ball_natural_key_uq").doUpdateSet({
        // Only fields that can actually change post-write — RV does
        // emit corrections for runs, descriptions, dismissals etc.
        // The natural-key columns themselves are excluded (they're how
        // we found the row in the first place).
        match_id: (eb) => eb.ref("excluded.match_id"),
        ball_no_disp: (eb) => eb.ref("excluded.ball_no_disp"),
        batter_rv_id: (eb) => eb.ref("excluded.batter_rv_id"),
        batter_ns_rv_id: (eb) => eb.ref("excluded.batter_ns_rv_id"),
        bowler_rv_id: (eb) => eb.ref("excluded.bowler_rv_id"),
        dismissed_batter_rv_id: (eb) =>
          eb.ref("excluded.dismissed_batter_rv_id"),
        runs_bat: (eb) => eb.ref("excluded.runs_bat"),
        runs_extra: (eb) => eb.ref("excluded.runs_extra"),
        extras_type: (eb) => eb.ref("excluded.extras_type"),
        l_desc: (eb) => eb.ref("excluded.l_desc"),
        s_desc: (eb) => eb.ref("excluded.s_desc"),
        ball_time_utc: (eb) => eb.ref("excluded.ball_time_utc"),
        ball_offset_seconds: (eb) => eb.ref("excluded.ball_offset_seconds"),
        highlight_events: (eb) => eb.ref("excluded.highlight_events"),
        ball_spot_x: (eb) => eb.ref("excluded.ball_spot_x"),
        ball_spot_y: (eb) => eb.ref("excluded.ball_spot_y"),
        shot_angle: (eb) => eb.ref("excluded.shot_angle"),
        shot_length: (eb) => eb.ref("excluded.shot_length"),
      }),
    )
    .execute();

  return rows.length;
}

function pickRecordingAnchor(streams: RvMatchStream[]): Date | null {
  let best: Date | null = null;
  for (const s of streams) {
    const d = parseMsDate(s.recording_started_utc);
    if (!d) continue;
    if (!best || d.getTime() < best.getTime()) best = d;
  }
  return best;
}
