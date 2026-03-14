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
        slotType: z.enum(["batting", "bowling", "fielding"]),
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

export type SaveTeamInput = z.infer<typeof saveTeamSchema>;
export type PlayerInput = SaveTeamInput["players"][number];
