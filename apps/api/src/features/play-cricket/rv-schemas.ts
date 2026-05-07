import { z } from "zod";

/**
 * Canonical extras codes used downstream (match_ball.extras_type, queries,
 * any future tooling). Matches the conventional Play Cricket / cricket
 * scoring shorthand.
 */
export type ExtrasCode = "wd" | "nb" | "b" | "lb";

const NUMERIC_TO_EXTRAS_CODE: Readonly<Record<number, ExtrasCode>> = {
  1: "nb",
  2: "wd",
  3: "b",
  4: "lb",
};

const STRING_TO_EXTRAS_CODE: Readonly<Record<string, ExtrasCode>> = {
  // Verbatim canonical codes (idempotent passthrough — guards against the
  // theoretical case of RV emitting strings, which we haven't actually
  // observed in prod but the field type allows).
  wd: "wd",
  nb: "nb",
  b: "b",
  lb: "lb",
  // s_desc-style and longer-form variants, in case RV ever returns those.
  w: "wd",
  wide: "wd",
  "no-ball": "nb",
  noball: "nb",
  bye: "b",
  "leg-bye": "lb",
  legbye: "lb",
};

/**
 * Map RV's mixed-shape extras_type wire value into our canonical string
 * code, or null. Pure function — callers (the ingest layer) handle
 * logging when an input is non-null but unmappable, since the schema
 * itself doesn't have a logger.
 *
 * RV emits one of:
 *   - null / undefined / ""  — no extra on this ball
 *   - numeric 1..4           — live-scored matches
 *   - string "wd"/"nb"/...   — theoretical (not seen in prod yet)
 *
 * Unknown shapes resolve to `null` (don't fabricate a meaning). The
 * caller decides whether that's worth surfacing — see `isUnmappedExtra`.
 */
export function canonicaliseExtrasType(
  raw: string | number | null | undefined,
): ExtrasCode | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return NUMERIC_TO_EXTRAS_CODE[raw] ?? null;
  }
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  return STRING_TO_EXTRAS_CODE[key] ?? null;
}

/**
 * True when RV sent something for extras_type but we couldn't map it to
 * a known cricketing extra. Use this at ingest time to log new RV codes
 * we haven't seen before — silently dropping to null would mask drift.
 */
export function isUnmappedExtra(
  raw: string | number | null | undefined,
  canonical: ExtrasCode | null,
): boolean {
  if (canonical != null) return false;
  if (raw == null) return false;
  if (typeof raw === "string" && raw.trim() === "") return false;
  return true;
}

// ResultsVault response schemas. The MatchCentre SPA bundle defines the
// canonical shapes via mobx-state-tree models; we only re-encode the fields
// we actually consume so a future bundle adding fields doesn't break us.
//
// All schemas use `.passthrough()`/`.loose()` semantics where it matters so
// unknown keys are tolerated.

// ── Mappings (PC id ↔ RV id) ──
//
// /rv/mappings/{instance}/{type}/{external_id}/?apiid=...&sportid=...
//
// `object_id1` is the RV-side id. Returns 0 when no mapping exists for the
// supplied external_id (rather than 404'ing).
export const RvMappingInfo = z.looseObject({
  object_id1: z.number(),
  mapping_id: z.number().optional(),
  object_type_id: z.number().optional(),
  mapping_instance: z.number().optional(),
});
export type RvMappingInfo = z.output<typeof RvMappingInfo>;

// ── Match overview ──
//
// /rv/130000/matches/{rvMatchId}/?apiid=...
//
// Massive payload — we only encode the fields the ingest reads. Each
// MatchTeam holds an Innings list whose PlayerPerfs carry the RV→PC
// player id mapping for free.

const RvPlayerPerf = z.looseObject({
  player_id: z.number(), // RV player id
  external_id: z.string().nullable().optional(), // PC's external id (string!)
  player_name: z.string().default(""),
  number: z.number().optional(), // batting position; not currently persisted
});
export type RvPlayerPerf = z.output<typeof RvPlayerPerf>;

const RvInnings = z.looseObject({
  innings_number: z.number().optional(),
  PlayerPerfs: z.array(RvPlayerPerf).default([]),
});

const RvMatchTeam = z.looseObject({
  team_name: z.string().default(""),
  result_id: z.number(),
  Innings: z.array(RvInnings).default([]),
});
export type RvMatchTeam = z.output<typeof RvMatchTeam>;

const RvMatchStream = z.looseObject({
  id: z.number(),
  match_id: z.number().optional(),
  video_id: z.string().default(""),
  frogbox_stream_id: z.string().default(""),
  stream_provider_id: z.number().default(0),
  // Microsoft DateTime serialisation: "/Date(epochms+TZ)/" — parsed downstream.
  start_utc: z.string().nullable().optional(),
  recording_started_utc: z.string().nullable().optional(),
  publish_status_id: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type RvMatchStream = z.output<typeof RvMatchStream>;

export const RvMatchOverview = z.looseObject({
  match_id: z.number(),
  external_match_id: z.number().optional(), // PC match id when sourced via mapping
  MatchTeams: z.array(RvMatchTeam).default([]),
  matchStreams: z.array(RvMatchStream).default([]),
});
export type RvMatchOverview = z.output<typeof RvMatchOverview>;

// ── Ball-by-ball ──
//
// /rv/130000/matches/{rvMatchId}/?apiid=...&action=getballs
//                                &sportid=1
//                                &resultid={result_id}
//                                &inningsnumber={n}
//
// Returns a flat array. Each ball describes a single delivery — including
// the bowled extra AND the rebowl as distinct entries. RV uses:
//
//   over_no        0-based over index within the innings
//   ball_no        1-based per-delivery sequence within the over —
//                  EVERY delivery (legal, wide, no-ball, rebowl) gets a
//                  distinct ball_no, so a 6-legal over with one wide
//                  has ball_no values 1..7. This is the natural unique
//                  key alongside over_no.
//   ball_no_disp   the cricketing display number ("8.2", "8.3"...) —
//                  shared between an extra and its rebowl, so NOT
//                  unique within an over.
//
// Combined natural key per innings is therefore (over_no, ball_no).

const RvHighlightEvent = z.looseObject({
  event_id: z.number(),
  metric: z.number().optional(),
});

export const RvBall = z.looseObject({
  innings_number: z.number(),
  over_no: z.number(),
  ball_no: z.number(),
  ball_no_disp: z.number(),
  result_id: z.number(),
  batter_id: z.number().nullable().optional(),
  batter_id_ns: z.number().nullable().optional(),
  bowler_id: z.number().nullable().optional(),
  dismissed_batter_id: z.number().nullable().optional(),
  runs_bat: z.number().default(0),
  runs_extra: z.number().default(0),
  // RV's BBB feed sends extras_type as null, a numeric code, or
  // (theoretically) a string. Schema is permissive — the canonicalisation
  // to our "wd"/"nb"/"b"/"lb" shape happens in the ingest layer, where
  // we have a place to log new/unmapped codes (see canonicaliseExtrasType
  // and isUnmappedExtra below).
  //
  // Numeric mapping cross-checked against l_desc / s_desc on match
  // 7464451 (PC 7262912):
  //
  //   1 = no-ball   (Mashal → Robson over 8.3 "4 runs, 1 nb")
  //   2 = wide      (Mashal → Robson over 8.2 "1 w")
  //   3 = bye       (Pulayakalathil → Percival over 29.1 "2 b")
  //   4 = leg-bye   (Mashal → Robson over 2.1 "1 lb")
  extras_type: z.union([z.string(), z.number()]).nullable().optional(),
  l_desc: z.string().default(""),
  s_desc: z.string().default(""),
  ball_time: z.string().nullable().optional(),
  match_highlight_events: z.array(RvHighlightEvent).default([]),
  ball_spot_x: z.number().nullable().optional(),
  ball_spot_y: z.number().nullable().optional(),
  shot_angle: z.number().nullable().optional(),
  shot_length: z.number().nullable().optional(),
});
export type RvBall = z.output<typeof RvBall>;

export const RvBallsResponse = z.array(RvBall);
