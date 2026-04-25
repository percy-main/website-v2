import {
  marketingLeadResponseSchema,
  marketingLeadSchema,
} from "@percy-main/shared/marketing";
import { z } from "zod";

export {
  marketingLeadResponseSchema,
  marketingLeadSchema,
} from "@percy-main/shared/marketing";

export const marketingLeadErrorSchema = z.object({
  error: z.string(),
});

export type MarketingLeadInput = z.infer<typeof marketingLeadSchema>;
export type MarketingLeadResponse = z.infer<typeof marketingLeadResponseSchema>;
