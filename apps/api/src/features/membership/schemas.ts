import { z } from "zod";

const priceOptionSchema = z.object({
  id: z.string(),
  unitAmount: z.number(),
  formattedPrice: z.string(),
  mode: z.enum(["subscription", "payment"]),
});

const membershipProductSchema = z.object({
  name: z.string(),
  monthly: priceOptionSchema,
  annually: priceOptionSchema,
});

export const membershipPricesResponseSchema = z.object({
  senior_player: membershipProductSchema,
  social: membershipProductSchema,
  concessionary: membershipProductSchema,
  senior_women_player: membershipProductSchema,
});

export type MembershipPricesResponse = z.infer<
  typeof membershipPricesResponseSchema
>;
