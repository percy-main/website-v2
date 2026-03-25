import { z } from "zod";

export const recordsQuerySchema = z.object({
  isJunior: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type RecordsQuery = z.infer<typeof recordsQuerySchema>;

const recordEntrySchema = z.object({
  title: z.string(),
  playerName: z.string(),
  slug: z.string().nullable(),
  value: z.string(),
  season: z.number(),
});

export const recordsResponseSchema = z.object({
  records: z.array(recordEntrySchema),
});

const honourEntrySchema = z.object({
  playerName: z.string(),
  slug: z.string().nullable(),
  value: z.string(),
  season: z.number(),
  matchDate: z.string(),
});

export const honoursResponseSchema = z.object({
  centuries: z.array(honourEntrySchema),
  fiveWicketHauls: z.array(honourEntrySchema),
});
