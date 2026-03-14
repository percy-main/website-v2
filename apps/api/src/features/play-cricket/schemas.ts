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
  contentfulEntryId: z.string(),
});

export const playerSeasonStatsSchema = z.object({
  contentfulEntryId: z.string(),
  season: z.coerce.number().int(),
});
