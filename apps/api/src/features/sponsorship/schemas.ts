import { z } from "zod";

// Game sponsorship
export const gameSponsorshipPaymentSchema = z.object({
  gameId: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.string().email(),
  sponsorWebsite: z.string().url().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
});

// Player sponsorship
export const playerSponsorshipPaymentSchema = z.object({
  contentfulEntryId: z.string(),
  playerName: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.string().email(),
  sponsorWebsite: z.string().url().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
});

export const sponsorshipListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  filter: z
    .enum(["all", "pending_payment", "pending_approval", "approved"])
    .default("all"),
});

export const sponsorshipActionSchema = z.object({
  sponsorshipId: z.string(),
});

export const sponsorshipUpdateSchema = z.object({
  sponsorshipId: z.string(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
  sponsorLogoDataUrl: z.string().optional(),
});

export const playerSponsorshipManualSchema = z.object({
  contentfulEntryId: z.string(),
  playerName: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.string().email(),
  sponsorWebsite: z.string().url().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
  amountPence: z.number().int().positive(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
});

export const gameSponsorshipManualSchema = z.object({
  gameId: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.string().email(),
  sponsorWebsite: z.string().url().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
  amountPence: z.number().int().positive(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
});

export const gameListSchema = z.object({
  search: z.string().optional(),
  season: z.coerce.number().optional(),
});

export const byGameIdSchema = z.object({
  gameId: z.string(),
});

export const byContentfulIdSchema = z.object({
  contentfulEntryId: z.string(),
});

export const allApprovedSchema = z.object({
  season: z.coerce.number().optional(),
});

export type GameSponsorshipPayment = z.infer<
  typeof gameSponsorshipPaymentSchema
>;
export type PlayerSponsorshipPayment = z.infer<
  typeof playerSponsorshipPaymentSchema
>;
export type SponsorshipList = z.infer<typeof sponsorshipListSchema>;
export type SponsorshipAction = z.infer<typeof sponsorshipActionSchema>;
export type SponsorshipUpdate = z.infer<typeof sponsorshipUpdateSchema>;
export type PlayerSponsorshipManual = z.infer<
  typeof playerSponsorshipManualSchema
>;
export type GameSponsorshipManual = z.infer<typeof gameSponsorshipManualSchema>;
