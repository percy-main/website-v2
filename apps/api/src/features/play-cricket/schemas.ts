import { z } from "zod";

export const matchDetailSchema = z.object({
  matchId: z.string(),
});

export const resultSummarySchema = z.object({
  matchId: z.string(),
  season: z.coerce.number().int(),
  ourTeamId: z.string(),
});

export const leagueTableSchema = z.object({
  divisionId: z.string(),
});

export const playerStatsSchema = z.object({
  slug: z.string(),
});

export const playerSeasonStatsSchema = z.object({
  slug: z.string(),
  season: z.coerce.number().int(),
});

// Response schemas

export const matchDetailResponseSchema = z.unknown();

export const resultSummaryResponseSchema = z
  .object({
    matchId: z.string(),
    season: z.number(),
    ourTeamId: z.string(),
    outcome: z.string(),
    description: z.string(),
    resultAppliedTo: z.string(),
  })
  .nullable();

export const leagueTableResponseSchema = z.union([
  z.object({
    columns: z.array(z.string()),
    rows: z.array(z.record(z.string(), z.string())),
  }),
  z.object({
    id: z.number(),
    name: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.record(z.string(), z.string())),
  }),
]);

export const teamsResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      site_id: z.string(),
      is_junior: z.boolean(),
      last_updated: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

const battingPerformanceSchema = z.object({
  id: z.string(),
  match_id: z.string(),
  match_date: z.string(),
  season: z.number(),
  player_id: z.string(),
  player_name: z.string(),
  team_id: z.string(),
  competition_type: z.string(),
  runs: z.number(),
  balls: z.number(),
  fours: z.number(),
  sixes: z.number(),
  how_out: z.string(),
  not_out: z.boolean(),
  times_out: z.number(),
  dismissal_penalty: z.number(),
  game_type: z.string(),
  created_at: z.string(),
});

const bowlingPerformanceSchema = z.object({
  id: z.string(),
  match_id: z.string(),
  match_date: z.string(),
  season: z.number(),
  player_id: z.string(),
  player_name: z.string(),
  team_id: z.string(),
  competition_type: z.string(),
  overs: z.string(),
  maidens: z.number(),
  runs: z.number(),
  wickets: z.number(),
  wides: z.number(),
  no_balls: z.number(),
  game_type: z.string(),
  created_at: z.string(),
});

export const liveScoresResponseSchema = z.object({
  matches: z.array(
    z.object({
      matchId: z.string(),
      matchDate: z.string(),
      batting: z.array(battingPerformanceSchema),
      bowling: z.array(bowlingPerformanceSchema),
      status: z.string(),
    }),
  ),
});

const battingSeasonSchema = z.object({
  season: z.number(),
  innings: z.number(),
  notOuts: z.number(),
  runs: z.number(),
  highScore: z.number(),
  average: z.number().nullable(),
  strikeRate: z.number().nullable(),
  fours: z.number(),
  sixes: z.number(),
  fifties: z.number(),
  hundreds: z.number(),
});

const bowlingSeasonSchema = z.object({
  season: z.number(),
  innings: z.number(),
  overs: z.string(),
  maidens: z.number(),
  runs: z.number(),
  wickets: z.number(),
  average: z.number().nullable(),
  economy: z.number().nullable(),
  strikeRate: z.number().nullable(),
  bestBowling: z.string().nullable(),
});

// Stats are partitioned by game_type so hardball and Women's Softball
// (Play Cricket "Pairs") get their own section on the profile. A format is
// omitted entirely when the player has no batting and no bowling data for it,
// so the UI never renders an empty card.
const playerFormatStatsSchema = z.object({
  gameType: z.enum(["Standard", "Pairs"]),
  label: z.string(),
  seasons: z.array(z.number()),
  battingSeasons: z.array(battingSeasonSchema),
  bowlingSeasons: z.array(bowlingSeasonSchema),
  career: z.object({
    batting: z.object({
      matches: z.number(),
      runs: z.number(),
      highScore: z.number(),
      notOuts: z.number(),
    }),
    bowling: z.object({
      innings: z.number(),
      wickets: z.number(),
      bestBowling: z
        .object({
          wickets: z.number(),
          runs: z.number(),
        })
        .nullable(),
    }),
  }),
});

export const playerCareerStatsResponseSchema = z
  .object({
    playCricketId: z.string(),
    formats: z.array(playerFormatStatsSchema),
  })
  .nullable();

export const triggerSyncResponseSchema = z.object({
  taskArn: z.string(),
});

export const playerSeasonStatsResponseSchema = z
  .object({
    playCricketId: z.string(),
    season: z.number(),
    batting: z.object({
      innings: z.number(),
      runs: z.number(),
      notOuts: z.number(),
      average: z.number().nullable(),
      highScore: z.number(),
      strikeRate: z.number().nullable(),
      fours: z.number(),
      sixes: z.number(),
      fifties: z.number(),
      hundreds: z.number(),
    }),
    bowling: z.object({
      innings: z.number(),
      overs: z.string(),
      maidens: z.number(),
      wickets: z.number(),
      runs: z.number(),
      average: z.number().nullable(),
      economy: z.number().nullable(),
      strikeRate: z.number().nullable(),
      bestBowling: z.string().nullable(),
    }),
  })
  .nullable();
