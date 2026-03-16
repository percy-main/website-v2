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
