import { z } from "zod";
import { respondSchema } from "../availability/schemas.ts";

// respondSchema's fields plus requestId — respond(db)'s real signature is
// (memberEmail, requestId, data), with requestId normally coming from a
// URL param the REST route supplies. MCP tool calls have no URL param, so
// it has to be part of the input schema instead.
export const confirmAvailabilitySchema = respondSchema.extend({
  requestId: z.string(),
});

export const oauthClientParamsSchema = z.object({
  clientId: z.string(),
});

export const oauthClientResponseSchema = z.object({
  name: z.string().nullable(),
  uri: z.string().nullable(),
  icon: z.string().nullable(),
});
