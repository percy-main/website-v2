import { z } from "zod";

export const marketingEventTypeSchema = z.enum([
  "generate_lead",
  "contact_form_submitted",
  "sign_up",
  "begin_checkout",
  "purchase",
  "lead_contacted",
  "lead_attended_session",
  "lead_became_member",
  "lead_lost",
]);

export type MarketingEventType = z.infer<typeof marketingEventTypeSchema>;
