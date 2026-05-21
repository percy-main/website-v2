import { z } from "zod";

// Currently a single channel field that applies to "all matchday
// notifications" (issue #379). Modelled as a discrete enum rather than
// two booleans so the wire shape stays stable when more notification
// categories land - a `<category>_channel` field per category is easy
// to add without renaming anything.
export const matchdayChannelSchema = z.enum(["email", "push", "both"]);
export type MatchdayChannel = z.infer<typeof matchdayChannelSchema>;

export const notificationPreferencesResponseSchema = z.object({
  matchdayChannel: matchdayChannelSchema,
});

export const updateNotificationPreferencesSchema = z.object({
  matchdayChannel: matchdayChannelSchema,
});
