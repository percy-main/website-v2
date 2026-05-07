import { z } from "zod";

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
// Returns a flat array. Each ball describes a single delivery — RV uses
// 0-based over_no and a per-innings 1-based ball_no that includes extras.

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
  extras_type: z.string().nullable().optional(),
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
