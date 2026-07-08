import { z } from "zod";

// --- Match Summary (list of matches for a season) ---

export const MatchSummaryMatch = z.object({
  id: z.number(),
  status: z.string(),
  published: z.string(),
  last_updated: z.string(),
  league_name: z.string().optional(),
  league_id: z.string().optional(),
  competition_name: z.string().optional(),
  competition_id: z.string().optional(),
  competition_type: z.string().optional(),
  match_type: z.string().optional(),
  game_type: z.string().optional(),
  season: z.string(),
  match_date: z.string(),
  match_time: z.string().optional(),
  ground_name: z.string().optional(),
  ground_id: z.string().optional(),
  ground_latitude: z.string().optional(),
  ground_longitude: z.string().optional(),
  home_club_name: z.string(),
  home_team_name: z.string(),
  home_team_id: z.string(),
  home_club_id: z.string(),
  away_club_name: z.string(),
  away_team_name: z.string(),
  away_team_id: z.string(),
  away_club_id: z.string(),
  umpire_1_name: z.string().optional(),
  umpire_1_id: z.string().optional(),
  umpire_2_name: z.string().optional(),
  umpire_2_id: z.string().optional(),
  umpire_3_name: z.string().optional(),
  umpire_3_id: z.string().optional(),
  referee_name: z.string().optional(),
  referee_id: z.string().optional(),
  scorer_1_name: z.string().optional(),
  scorer_1_id: z.string().optional(),
  scorer_2_name: z.string().optional(),
  scorer_2_id: z.string().optional(),
});

export type MatchSummaryMatch = z.output<typeof MatchSummaryMatch>;

export const GetMatchSummaryResponse = z.object({
  matches: z.array(MatchSummaryMatch),
});

// --- Match Detail (full scorecard) ---

export const MatchDetailBat = z.object({
  position: z.string(),
  batsman_name: z.string(),
  batsman_id: z.string(),
  how_out: z.string().nullable().optional(),
  fielder_name: z.string().nullable().optional(),
  fielder_id: z.string().nullable().optional(),
  bowler_name: z.string().nullable().optional(),
  bowler_id: z.string().nullable().optional(),
  runs: z.string(),
  fours: z.string(),
  sixes: z.string(),
  balls: z.string(),
  // Pairs / Women's Softball: per-batter dismissal count (can be 0, 1, 2+).
  // Empty string for "did not bat". Absent on older / non-Pairs responses.
  times_out: z.string().optional().default(""),
});

export type MatchDetailBat = z.output<typeof MatchDetailBat>;

export const MatchDetailBowl = z.object({
  bowler_name: z.string(),
  bowler_id: z.string(),
  overs: z.string(),
  maidens: z.string(),
  runs: z.string(),
  wides: z.string(),
  wickets: z.string(),
  no_balls: z.string(),
});

export const MatchDetailFoW = z.object({
  runs: z.string(),
  wickets: z.number(),
  batsman_out_name: z.string(),
  batsman_out_id: z.string(),
  batsman_in_name: z.string().optional().default(""),
  batsman_in_id: z.string().optional().default(""),
  batsman_in_runs: z.string().optional().default(""),
});

export const MatchDetailPlayer = z.object({
  position: z.number(),
  player_name: z.string(),
  player_id: z.number().nullable(),
  captain: z.boolean(),
  wicket_keeper: z.boolean(),
});

export const MatchDetailInnings = z.object({
  team_batting_name: z.string(),
  team_batting_id: z.string(),
  innings_number: z.number(),
  extra_byes: z.string(),
  extra_leg_byes: z.string(),
  extra_wides: z.string(),
  extra_no_balls: z.string(),
  extra_penalty_runs: z.string(),
  penalties_runs_awarded_in_other_innings: z.string(),
  total_extras: z.string(),
  runs: z.string(),
  wickets: z.string(),
  overs: z.string(),
  declared: z.boolean().nullable().default(false),
  revised_target_runs: z.string(),
  revised_target_overs: z.string(),
  bat: z.array(MatchDetailBat),
  bowl: z.array(MatchDetailBowl),
  fow: z.array(MatchDetailFoW),
});

// Per-team scoring metadata (game points, bonus points, etc.) returned for both
// hardball and softball matches. For Pairs games the only populated entry is
// `game_points` (e.g. winning side gets 15); for hardball there are also
// batting / bowling bonus point breakdowns.
//
// team_id is observed as a number in real responses but every other team_id
// in this API is a string - the union guards against PC emitting a string
// here in the future without breaking the whole match-detail parse.
export const MatchDetailPoints = z.object({
  team_id: z.union([z.number(), z.string()]),
  game_points: z.string().optional().default(""),
  penalty_points: z.string().optional().default(""),
  bonus_points_together: z.string().optional().default(""),
  bonus_points_batting: z.string().optional().default(""),
  bonus_points_bowling: z.string().optional().default(""),
  bonus_points_2nd_innings_together: z.string().optional().default(""),
});

export const MatchDetail = z.object({
  id: z.number(),
  home_team_name: z.string(),
  home_team_id: z.string(),
  home_club_name: z.string(),
  home_club_id: z.string().optional().default(""),
  away_team_name: z.string(),
  away_team_id: z.string(),
  away_club_name: z.string(),
  away_club_id: z.string().optional().default(""),
  toss: z.string().optional().default(""),
  batted_first: z.string().optional().default(""),
  result: z.string().optional().default(""),
  result_description: z.string().optional().default(""),
  result_applied_to: z.string().optional().default(""),
  match_type: z.string().optional().default(""),
  competition_type: z.string().optional().default(""),
  match_date: z.string().optional().default(""),
  season: z.string().optional().default(""),
  // "Standard" for hardball, "Pairs" for Women's Softball etc. Drives scoring
  // rules (starting_runs + dismissal_penalty are only populated for Pairs).
  game_type: z.string().optional().default(""),
  // Pairs-specific: the team's starting score before runs are added (e.g. 200)
  // and the runs deducted per dismissal (e.g. 5). Net score is
  // starting_runs + innings.runs - innings.wickets * dismissal_penalty.
  starting_runs: z.string().optional().default(""),
  dismissal_penalty: z.string().optional().default(""),
  league_name: z.string().optional().default(""),
  competition_name: z.string().optional().default(""),
  points: z.array(MatchDetailPoints).optional().default([]),
  players: z.array(
    z.object({
      home_team: z.array(MatchDetailPlayer).optional(),
      away_team: z.array(MatchDetailPlayer).optional(),
    }),
  ),
  innings: z.array(MatchDetailInnings),
});

export const GetMatchDetailResponse = z.object({
  match_details: z.array(MatchDetail),
});

// --- Result summary (played matches with innings totals) ---
//
// /result_summary.json?site_id=...&season=... — one row per played match,
// updated by Play Cricket within minutes of a scorer posting a result.
// Only the fields the recent-games feature consumes are encoded; unknown
// keys are stripped by z.object.

export const ResultSummaryInnings = z.object({
  team_batting_id: z.string(),
  innings_number: z.number().optional(),
  runs: z.string().optional().default(""),
  wickets: z.string().optional().default(""),
  overs: z.string().optional().default(""),
  declared: z.boolean().nullable().default(false),
  forfeited_innings: z.boolean().nullable().default(false),
});

export const ResultSummaryMatch = z.object({
  id: z.number(),
  status: z.string().optional().default(""),
  published: z.string().optional().default(""),
  last_updated: z.string().optional().default(""),
  league_name: z.string().optional().default(""),
  league_id: z.string().optional().default(""),
  competition_name: z.string().optional().default(""),
  competition_id: z.string().optional().default(""),
  competition_type: z.string().optional().default(""),
  match_type: z.string().optional().default(""),
  // "Standard" hardball or "Pairs" Women's Softball — Pairs margins don't
  // follow runs/wickets semantics, so the recent-games note skips them.
  game_type: z.string().optional().default(""),
  match_date: z.string(),
  match_time: z.string().optional().default(""),
  home_team_name: z.string(),
  home_team_id: z.string(),
  home_club_name: z.string(),
  home_club_id: z.string(),
  away_team_name: z.string(),
  away_team_id: z.string(),
  away_club_name: z.string(),
  away_club_id: z.string(),
  batted_first: z.string().optional().default(""),
  result: z.string().optional().default(""),
  result_description: z.string().optional().default(""),
  result_applied_to: z.string().optional().default(""),
  innings: z.array(ResultSummaryInnings).optional().default([]),
});

export type ResultSummaryMatch = z.output<typeof ResultSummaryMatch>;

export const GetResultSummaryResponse = z.object({
  result_summary: z.array(ResultSummaryMatch),
});

// --- Lenient match detail for live (in-play) reads ---
//
// The full MatchDetail schema requires scorecard fields (extras, bat, bowl,
// fow) that Play Cricket may serve incompletely mid-innings. The live
// scoreboard only needs running totals and the (empty-until-final) result
// fields, so it parses this forgiving subset instead — a malformed innings
// entry must degrade to "in play, no score" rather than fail the request.

// Play Cricket emits null for not-yet-populated live fields; collapse
// null/undefined to "" so consumers see one empty shape.
const liveString = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

const LiveMatchDetailInnings = z.object({
  team_batting_id: liveString,
  runs: liveString,
  wickets: liveString,
  overs: liveString,
  declared: z.boolean().nullable().default(false),
});

export const LiveMatchDetail = z.object({
  id: z.number(),
  home_team_name: z.string(),
  home_team_id: z.string(),
  home_club_name: z.string(),
  home_club_id: liveString,
  away_team_name: z.string(),
  away_team_id: z.string(),
  away_club_name: z.string(),
  away_club_id: liveString,
  result: liveString,
  result_description: liveString,
  result_applied_to: liveString,
  game_type: liveString,
  match_type: liveString,
  innings: z.array(LiveMatchDetailInnings).optional().default([]),
});

export type LiveMatchDetail = z.output<typeof LiveMatchDetail>;

export const GetLiveMatchDetailResponse = z.object({
  match_details: z.array(LiveMatchDetail),
});

// --- Teams ---

export const GetPlayersResponse = z.object({
  players: z.array(
    z.object({
      member_id: z.number(),
      name: z.string(),
    }),
  ),
});

export const GetTeamsResponse = z.object({
  teams: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      status: z.string(),
      last_updated: z.string(),
      site_id: z.union([z.string(), z.number()]),
      team_name: z.string(),
      other_team_name: z.string().optional().default(""),
      nickname: z.string().optional().default(""),
      team_captain: z.string().optional().default(""),
    }),
  ),
});
