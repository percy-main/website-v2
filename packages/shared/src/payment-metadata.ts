import { isMatching } from "ts-pattern";
import { z } from "zod";

export const gameSponsoredSchema = z.object({
  type: z.literal("sponsorGame"),
  gameId: z.string(),
  sponsorshipId: z.string().optional(),
});
export type GameSponsored = z.output<typeof gameSponsoredSchema>;

export const playerSponsoredSchema = z.object({
  type: z.literal("sponsorPlayer"),
  slug: z.string(),
  sponsorshipId: z.string(),
});
export type PlayerSponsored = z.output<typeof playerSponsoredSchema>;

export const membershipSchema = z.object({
  type: z.literal("membership"),
  membership: z.union([
    z.literal("social"),
    z.literal("senior_player"),
    z.literal("senior_women_player"),
    z.literal("concessionary"),
  ]),
});

export const metadata = z.union([
  gameSponsoredSchema,
  playerSponsoredSchema,
  membershipSchema,
  z.undefined(),
]);
export type Metadata = z.output<typeof metadata>;

export const is =
  <const Type extends Exclude<Metadata, undefined>["type"]>(type: Type) =>
  (meta: Metadata): meta is Extract<Metadata, { type: Type }> =>
    isMatching<Partial<Metadata>>({ type })(meta);
