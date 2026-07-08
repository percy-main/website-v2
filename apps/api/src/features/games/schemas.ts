import { z } from "zod";

export const gamesListSchema = z.object({
  season: z.coerce.number().int().optional(),
});

export const gameDetailParamsSchema = z.object({
  matchId: z.string().min(1),
});

// Response schemas

const teamIdNameSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const matchSummaryFieldsSchema = z.object({
  id: z.string(),
  matchDate: z.string(),
  matchTime: z.string().nullable(),
  home: z.boolean(),
  team: teamIdNameSchema,
  opposition: z.object({
    club: teamIdNameSchema,
    team: teamIdNameSchema,
  }),
  league: teamIdNameSchema,
  competition: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  groundName: z.string().nullable(),
});

const outcomeSchema = z.enum(["W", "L", "D", "T", "A", "C", "N"]).nullable();

export const gameListItemSchema = matchSummaryFieldsSchema.extend({
  when: z.string().nullable(),
  outcome: outcomeSchema,
  scoreDescription: z.string().nullable(),
  sponsorName: z.string().nullable(),
  sponsorLogoUrl: z.string().nullable(),
});

export const gamesListResponseSchema = z.array(gameListItemSchema);

const locationSchema = z
  .object({
    name: z.string(),
    street: z.string().optional(),
    city: z.string().optional(),
    postcode: z.string().optional(),
    county: z.string().optional(),
    country: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
  })
  .nullable();

const inningsSchema = z.object({
  teamBattingId: z.string(),
  teamName: z.string(),
  runs: z.number(),
  wickets: z.number(),
  overs: z.string(),
  declared: z.boolean(),
  allOut: z.boolean(),
  // Play Cricket net score for Women's Softball (Pairs): starting_runs +
  // runs - wickets * dismissal_penalty. Null for hardball.
  netScore: z.number().nullable(),
});

const resultSchema = z
  .object({
    outcome: outcomeSchema,
    description: z.string(),
    toss: z.string(),
    // "Standard" hardball or "Pairs" Women's Softball - drives Net Score
    // display on the result summary card.
    gameType: z.string(),
    innings: z.array(inningsSchema),
  })
  .nullable();

const sponsorSchema = z
  .object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    message: z.string().nullable(),
    website: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .nullable();

const lineupPlayerSchema = z.object({
  name: z.string(),
});

const lineupSchema = z
  .object({
    confirmed: z.boolean(),
    matchdayId: z.string(),
    players: z.array(lineupPlayerSchema),
  })
  .nullable();

const availabilityRequestSummarySchema = z
  .object({
    id: z.string(),
    status: z.string(),
    date: z.string(),
  })
  .nullable();

export const gameDetailResponseSchema = gameListItemSchema.extend({
  location: locationSchema,
  result: resultSchema,
  sponsor: sponsorSchema,
  lineup: lineupSchema,
  availabilityRequest: availabilityRequestSummarySchema,
});

// --- Recent games (homepage scoreboard) ---

const recentGameInningsSchema = z.object({
  teamBattingId: z.string(),
  teamName: z.string(),
  runs: z.number(),
  wickets: z.number(),
  overs: z.string(),
  declared: z.boolean(),
  allOut: z.boolean(),
});

export const recentGameItemSchema = z.object({
  id: z.string(),
  status: z.enum(["live", "result"]),
  when: z.string().nullable(),
  home: z.boolean(),
  team: teamIdNameSchema,
  opposition: z.object({
    club: teamIdNameSchema,
    team: teamIdNameSchema,
  }),
  league: teamIdNameSchema,
  competition: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  outcome: outcomeSchema,
  // "Won by 5 wickets" / "Mitford CC need 74 more to win" / "In play" ...
  note: z.string().nullable(),
  // Batting order preserved; empty while a live game has no scores yet.
  innings: z.array(recentGameInningsSchema),
});

export const recentGamesResponseSchema = z.object({
  items: z.array(recentGameItemSchema),
  hasLive: z.boolean(),
});

// --- Prerender manifest ---

// Consumed by the prerenderer Lambda (apps/web/server/prerender), merged
// with the content manifest. `hash` is an opaque content fingerprint -
// the diff key for pages whose sources carry no update timestamps.
export const gamesPrerenderManifestResponseSchema = z.object({
  items: z.array(
    z.object({
      url: z.string(),
      kind: z.enum(["game", "calendar-month"]),
      slug: z.string(),
      updatedAt: z.string(),
      publishedAt: z.string(),
      hash: z.string(),
    }),
  ),
});

// --- Wagon wheel ---

const wagonWheelBallSchema = z.object({
  over: z.number(),
  ball: z.number(),
  ballDisp: z.number(),
  batterRvId: z.number().nullable(),
  batterName: z.string().nullable(),
  bowlerRvId: z.number().nullable(),
  bowlerName: z.string().nullable(),
  dismissed: z.boolean(),
  runsBat: z.number(),
  runsExtra: z.number(),
  extrasType: z.string().nullable(),
  lDesc: z.string(),
  sDesc: z.string(),
  shotAngle: z.number().nullable(),
  shotLength: z.number().nullable(),
});

export const wagonWheelResponseSchema = z.object({
  matchId: z.string(),
  dismissalPenalty: z.number(),
  innings: z.array(
    z.object({
      inningsNumber: z.number(),
      balls: z.array(wagonWheelBallSchema),
    }),
  ),
});
