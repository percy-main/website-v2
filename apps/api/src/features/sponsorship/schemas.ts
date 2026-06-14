import { z } from "zod";

// Game sponsorship
export const gameSponsorshipPaymentSchema = z.object({
  gameId: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.email(),
  sponsorWebsite: z.string().optional(),
  sponsorPhone: z.string().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
});

// Player sponsorship
export const playerSponsorshipPaymentSchema = z.object({
  slug: z.string(),
  playerName: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.email(),
  sponsorWebsite: z.string().optional(),
  sponsorPhone: z.string().optional(),
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
  sponsorLogoDataUrl: z.string().nullable().optional(),
  sponsorWebsite: z.string().nullable().optional(),
  sponsorPhone: z.string().nullable().optional(),
});

export const playerSponsorshipManualSchema = z.object({
  slug: z.string(),
  playerName: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.email(),
  sponsorWebsite: z.string().optional(),
  sponsorPhone: z.string().optional(),
  sponsorLogoDataUrl: z.string().optional(),
  sponsorMessage: z.string().optional(),
  amountPence: z.number().int().positive(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
});

export const gameSponsorshipManualSchema = z.object({
  gameId: z.string(),
  sponsorName: z.string().min(1),
  sponsorEmail: z.email(),
  sponsorWebsite: z.string().optional(),
  sponsorPhone: z.string().optional(),
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

export const bySlugSchema = z.object({
  slug: z.string(),
});

export const sponsorshipIdParamSchema = z.object({
  sponsorshipId: z.string(),
});

export const allApprovedSchema = z.object({
  season: z.coerce.number().optional(),
});

// ── Response schemas ──

export const priceResponseSchema = z.object({
  amountPence: z.number(),
  currency: z.string(),
  productName: z.string(),
});

const gameSponsorshipRowSchema = z.object({
  id: z.string(),
  game_id: z.string(),
  sponsor_name: z.string(),
  sponsor_email: z.string(),
  sponsor_website: z.string().nullable(),
  sponsor_phone: z.string().nullable(),
  sponsor_logo_url: z.string().nullable(),
  sponsor_message: z.string().nullable(),
  amount_pence: z.number(),
  approved: z.boolean(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
  display_name: z.string().nullable(),
  notes: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
});

const playerSponsorshipRowSchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  player_name: z.string(),
  sponsor_name: z.string(),
  sponsor_email: z.string(),
  sponsor_website: z.string().nullable(),
  sponsor_phone: z.string().nullable(),
  sponsor_logo_url: z.string().nullable(),
  sponsor_message: z.string().nullable(),
  amount_pence: z.number(),
  season: z.number(),
  approved: z.boolean(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
  display_name: z.string().nullable(),
  notes: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
});

// Public projection of a player sponsorship: only the fields shown on
// public pages (person cards, profile, leaderboard). Deliberately omits
// sponsor_email, amount_pence, paid_at, notes and stripe_payment_intent_id
// - those are private/financial and must never reach the browser, since
// these routes are unauthenticated and their responses get cached client
// side.
const publicPlayerSponsorSchema = z.object({
  slug: z.string().nullable(),
  sponsor_name: z.string(),
  display_name: z.string().nullable(),
  sponsor_website: z.string().nullable(),
  sponsor_phone: z.string().nullable(),
  sponsor_logo_url: z.string().nullable(),
  sponsor_message: z.string().nullable(),
});

/** Columns the public projection selects - keep in sync with the schema. */
export const publicPlayerSponsorColumns = [
  "slug",
  "sponsor_name",
  "display_name",
  "sponsor_website",
  "sponsor_phone",
  "sponsor_logo_url",
  "sponsor_message",
] as const;

// Public projection of a game sponsorship - same rationale as the player
// one above: this route is unauthenticated, so omit sponsor_email,
// amount_pence, paid_at, notes and stripe_payment_intent_id.
const publicGameSponsorSchema = z.object({
  game_id: z.string(),
  sponsor_name: z.string(),
  display_name: z.string().nullable(),
  sponsor_website: z.string().nullable(),
  sponsor_phone: z.string().nullable(),
  sponsor_logo_url: z.string().nullable(),
  sponsor_message: z.string().nullable(),
});

/** Columns the public projection selects - keep in sync with the schema. */
export const publicGameSponsorColumns = [
  "game_id",
  "sponsor_name",
  "display_name",
  "sponsor_website",
  "sponsor_phone",
  "sponsor_logo_url",
  "sponsor_message",
] as const;

export const approvedPlayerSponsorsResponseSchema = z.object({
  sponsors: z.array(publicPlayerSponsorSchema),
});

export const gameSponsorResponseSchema = z.object({
  sponsor: publicGameSponsorSchema.nullable(),
});

export const playerSponsorResponseSchema = z.object({
  sponsor: publicPlayerSponsorSchema.nullable(),
});

export const hasPendingResponseSchema = z.object({
  hasPending: z.boolean(),
});

export const paymentResponseSchema = z.object({
  clientSecret: z.string().nullable(),
  amount: z.number(),
  productName: z.string(),
});

export const gameSponsorshipListResponseSchema = z.object({
  items: z.array(gameSponsorshipRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const playerSponsorshipListResponseSchema = z.object({
  items: z.array(playerSponsorshipRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const idResponseSchema = z.object({
  id: z.string(),
});

export const takenSlugsResponseSchema = z.object({
  slugs: z.array(z.string()),
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
