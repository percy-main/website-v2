import { attributionSchema } from "@percy-main/shared/marketing";
import { z } from "zod";

export const contactSubmissionSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  message: z.string().min(1),
  page: z.string().min(1),
  campaignId: z.string().optional(),
  segment: z.string().optional(),
  attribution: attributionSchema.optional(),
});

export const eventSubscriberSchema = z.object({
  email: z.email(),
  meta: z.record(z.string(), z.unknown()),
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
export type EventSubscriber = z.infer<typeof eventSubscriberSchema>;

export const contactResponseSchema = z.object({
  id: z.string(),
});

export const eventSubscriberResponseSchema = z.object({
  id: z.string(),
});
