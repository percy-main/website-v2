import { z } from "zod";

export const seasonSchema = z.object({
  season: z.string().optional(),
});

export const toggleEligibilitySchema = z.object({
  playCricketId: z.string(),
  eligible: z.boolean(),
});

export const saveTeamSchema = z.object({
  season: z.string().optional(),
  players: z
    .array(
      z.object({
        playCricketId: z.string(),
        isCaptain: z.boolean(),
        slotType: z.enum(["batting", "bowling", "allrounder"]),
        isWicketkeeper: z.boolean(),
      }),
    )
    .length(11),
});

export const listPlayersSchema = z.object({
  search: z.string().optional(),
});

export const calculateCostsSchema = z.object({
  season: z.string().optional(),
});

export const calculateScoresSchema = z.object({
  season: z.string().optional(),
});

export const weeklyLeaderboardSchema = z.object({
  season: z.string().optional(),
  gameweek: z.coerce.number().optional(),
});

export const teamIdSchema = z.object({
  teamId: z.coerce.number(),
});

export const gameweekDetailSchema = z.object({
  teamId: z.coerce.number(),
  gameweek: z.coerce.number(),
});

export const playerHistorySchema = z.object({
  playCricketId: z.string(),
});

export const chipSchema = z.object({
  chipType: z.enum(["triple_captain"]),
  season: z.string().optional(),
});

export const sandwichEfficiencySchema = z.object({
  season: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const highlightsSchema = z.object({
  season: z.string().optional(),
  gameweek: z.coerce.number().optional(),
});

export const chaosWeekPublicSchema = z.object({
  season: z.string().optional(),
  gameweek: z.coerce.number().optional(),
});

export const createChaosWeekSchema = z.object({
  season: z.string().optional(),
  gameweekId: z.number().min(1),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  ruleType: z.enum([
    "no_transfers",
    "no_captain_change",
    "no_captain_multiplier",
    "scoring_modifier",
    "scoring_threshold",
  ]),
  ruleConfig: z.string().optional(),
});

export const deleteChaosWeekSchema = z.object({
  id: z.number(),
});

export type SaveTeamInput = z.infer<typeof saveTeamSchema>;
export type PlayerInput = SaveTeamInput["players"][number];

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

const slotTypeSchema = z.enum(["batting", "bowling", "allrounder"]);

// getTransferWindow
export const transferWindowResponseSchema = z.object({
  locked: z.boolean(),
  gameweek: z.number(),
  isPreSeason: z.boolean(),
  daysUntilLock: z.number(),
});

// getChaosWeekPublic — returns a chaos week row or null
const chaosWeekRowSchema = z.object({
  id: z.number(),
  season: z.string(),
  gameweek_id: z.number(),
  name: z.string(),
  description: z.string(),
  rule_type: z.string(),
  rule_config: z.string(),
  send_email: z.boolean(),
  email_sent: z.boolean(),
  created_at: z.string(),
});

export const chaosWeekPublicResponseSchema = chaosWeekRowSchema.nullable();

// getPreSeasonStats
export const preSeasonStatsResponseSchema = z.object({
  teamCount: z.number(),
  totalSandwiches: z.number(),
});

// getOwnershipOverview
export const ownershipOverviewResponseSchema = z.object({
  mostOwned: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      ownershipPct: z.number(),
    }),
  ),
  mostCaptained: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      captainPct: z.number(),
    }),
  ),
  differentials: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      points: z.number(),
      ownershipPct: z.number(),
      sandwichCost: z.number(),
    }),
  ),
  teamCount: z.number(),
  gameweek: z.number(),
});

// getSandwichEfficiency
export const sandwichEfficiencyResponseSchema = z.object({
  season: z.string(),
  isFromPreviousSeason: z.boolean(),
  entries: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      sandwichCost: z.number(),
      totalPoints: z.number(),
      matchesPlayed: z.number(),
      pointsPerSandwich: z.number(),
      rank: z.number(),
    }),
  ),
});

// getGameweekHighlights
const highlightPlayerSchema = z.object({
  playerName: z.string(),
  playCricketId: z.string(),
  totalPoints: z.number(),
});

export const highlightsResponseSchema = z.object({
  highlights: z
    .object({
      topScorer: highlightPlayerSchema.nullable(),
      bestSpell: z
        .object({
          playerName: z.string(),
          playCricketId: z.string(),
          bowlingPoints: z.number(),
          totalPoints: z.number(),
        })
        .nullable(),
      fantasyShock: z
        .object({
          playerName: z.string(),
          playCricketId: z.string(),
          totalPoints: z.number(),
          ownershipPct: z.number(),
        })
        .nullable(),
      topTeam: z
        .object({
          teamId: z.number(),
          ownerName: z.string(),
          totalPoints: z.number(),
        })
        .nullable(),
      biggestMover: z
        .object({
          ownerName: z.string(),
          teamId: z.number(),
          rankChange: z.number(),
          currentRank: z.number(),
          previousRank: z.number(),
        })
        .nullable(),
      mostCaptained: z
        .object({
          playerName: z.string(),
          playCricketId: z.string(),
          captainPct: z.number(),
        })
        .nullable(),
      differentialPick: z
        .object({
          playerName: z.string(),
          playCricketId: z.string(),
          totalPoints: z.number(),
          ownershipPct: z.number(),
        })
        .nullable(),
      teamCount: z.number(),
    })
    .nullable(),
  gameweek: z.number(),
  season: z.string(),
});

// getSeasonLeaderboard
export const seasonLeaderboardResponseSchema = z.object({
  entries: z.array(
    z.object({
      teamId: z.number(),
      ownerName: z.string(),
      totalPoints: z.number(),
      gameweeksPlayed: z.number(),
      rank: z.number(),
    }),
  ),
  season: z.string(),
});

// getWeeklyLeaderboard
export const weeklyLeaderboardResponseSchema = z.object({
  entries: z.array(
    z.object({
      teamId: z.number(),
      ownerName: z.string(),
      weeklyPoints: z.number(),
      rank: z.number(),
    }),
  ),
  gameweek: z.number(),
  season: z.string(),
  availableGameweeks: z.array(z.number()),
});

// getPlayerLeaderboard
export const playerLeaderboardResponseSchema = z.object({
  entries: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      battingPoints: z.number(),
      bowlingPoints: z.number(),
      fieldingPoints: z.number(),
      teamPoints: z.number(),
      totalPoints: z.number(),
      matchesPlayed: z.number(),
      rank: z.number(),
    }),
  ),
  season: z.string(),
});

// listTeams
export const listTeamsResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.number(),
      season: z.string(),
      ownerName: z.string(),
      ownerId: z.string(),
      createdAt: z.string(),
    }),
  ),
  season: z.string(),
});

// getTeam (public team detail)
export const teamDetailResponseSchema = z.object({
  team: z.object({
    id: z.number(),
    season: z.string(),
    ownerName: z.string(),
    ownerId: z.string(),
  }),
  players: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      sandwichCost: z.number(),
      isCaptain: z.boolean(),
      slotType: slotTypeSchema,
      isWicketkeeper: z.boolean(),
      ownershipPct: z.number(),
    }),
  ),
});

// getSeasonTimeline
export const seasonTimelineResponseSchema = z.object({
  timeline: z.array(
    z.object({
      gameweek: z.number(),
      weeklyPoints: z.number(),
      cumulativePoints: z.number(),
    }),
  ),
  season: z.string(),
  teamId: z.number(),
});

// getGameweekDetail
export const gameweekDetailResponseSchema = z.object({
  team: z.object({
    id: z.number(),
    ownerName: z.string(),
    totalPoints: z.number(),
  }),
  gameweek: z.number(),
  season: z.string(),
  activeChips: z.array(z.string()),
  players: z.array(
    z.object({
      playCricketId: z.string(),
      playerName: z.string(),
      isCaptain: z.boolean(),
      slotType: slotTypeSchema,
      isWicketkeeper: z.boolean(),
      battingPoints: z.number(),
      bowlingPoints: z.number(),
      fieldingPoints: z.number(),
      teamPoints: z.number(),
      basePoints: z.number(),
      effectivePoints: z.number(),
      captainMultiplier: z.number(),
      matchCount: z.number(),
    }),
  ),
});

// getPlayerHistory
export const playerHistoryResponseSchema = z.object({
  playerName: z.string(),
  playCricketId: z.string(),
  season: z.string(),
  gameweeks: z.array(
    z.object({
      gameweek: z.number(),
      battingPoints: z.number(),
      bowlingPoints: z.number(),
      fieldingPoints: z.number(),
      teamPoints: z.number(),
      totalPoints: z.number(),
      matchCount: z.number(),
    }),
  ),
});

// getEligiblePlayers (authenticated)
export const eligiblePlayersResponseSchema = z.object({
  players: z.array(
    z.object({
      play_cricket_id: z.string(),
      player_name: z.string(),
      sandwich_cost: z.number(),
      eligible: z.boolean(),
      created_at: z.string(),
      previousSeasonPoints: z.number(),
      ownershipPercent: z.number(),
    }),
  ),
  season: z.string(),
  previousSeason: z.string(),
  budget: z.number(),
});

// getMyTeam (authenticated)
export const myTeamResponseSchema = z.object({
  team: z
    .object({
      id: z.number(),
      user_id: z.string(),
      season: z.string(),
      created_at: z.string(),
    })
    .nullable(),
  players: z.array(z.record(z.string(), z.unknown())),
  gameweek: z.number(),
  transfersUsed: z.number(),
  maxTransfers: z.number().nullable(),
  chaosWeek: chaosWeekRowSchema.nullable(),
});

// saveTeam
export const saveTeamResponseSchema = z.object({
  teamId: z.number(),
  isNew: z.boolean(),
});

// getChipStatus (authenticated)
export const chipStatusResponseSchema = z.object({
  chips: z.array(
    z.object({
      chipType: z.string(),
      usedThisSeason: z.number(),
      maxPerSeason: z.number(),
      activeThisGameweek: z.boolean(),
    }),
  ),
  gameweek: z.number(),
});

// activateChip / deactivateChip / deleteChaosWeek
export const successResponseSchema = z.object({
  success: z.boolean(),
});

// getTeamShareData (authenticated) — 404 handled in route, so response is the non-null shape
export const teamShareDataResponseSchema = z.object({
  ownerName: z.string(),
  season: z.string(),
  totalSandwichCost: z.number(),
  gameweekLabel: z.string(),
  players: z.array(
    z.object({
      playerName: z.string(),
      sandwichCost: z.number(),
      isCaptain: z.boolean(),
      slotType: slotTypeSchema,
      isWicketkeeper: z.boolean(),
    }),
  ),
});

// listPlayers (admin)
export const adminListPlayersResponseSchema = z.object({
  players: z.array(
    z.object({
      play_cricket_id: z.string(),
      player_name: z.string(),
      sandwich_cost: z.number(),
      eligible: z.boolean(),
      created_at: z.string(),
    }),
  ),
});

// toggleEligibility (admin)
export const toggleEligibilityResponseSchema = z.object({
  playCricketId: z.string(),
  eligible: z.boolean(),
});

// populatePlayers (admin)
export const populatePlayersResponseSchema = z.object({
  total: z.number(),
  inserted: z.number(),
});

// calculateSandwichCosts (admin)
export const calculateCostsResponseSchema = z.object({
  updated: z.number(),
  season: z.string(),
  previousSeason: z.string(),
});

// calculateFantasyScores (admin)
export const calculateScoresResponseSchema = z.object({
  playerScoresUpserted: z.number(),
  teamScoresUpserted: z.number(),
});

// listChaosWeeks (admin)
export const listChaosWeeksResponseSchema = z.object({
  weeks: z.array(chaosWeekRowSchema),
  season: z.string(),
});

// createChaosWeek (admin)
export const createChaosWeekResponseSchema = z.object({
  id: z.number(),
  season: z.string(),
  gameweekId: z.number(),
});
