import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type { MatchdayChannel, matchdayChannelSchema } from "./schemas.ts";

const DEFAULT_MATCHDAY_CHANNEL: MatchdayChannel = "email";

// Read the caller's preferences, defaulting to the same shape new users
// see. Returning a populated default rather than nullable keeps every
// consumer (UI + send path) from re-implementing the same fallback.
export function getNotificationPreferences(db: Kysely<DB>) {
  return async (
    userId: string,
  ): Promise<{ matchdayChannel: MatchdayChannel }> => {
    const row = await db
      .selectFrom("notification_preferences")
      .select(["matchday_channel"])
      .where("user_id", "=", userId)
      .executeTakeFirst();

    return {
      matchdayChannel:
        (row?.matchday_channel as MatchdayChannel | undefined) ??
        DEFAULT_MATCHDAY_CHANNEL,
    };
  };
}

export function upsertNotificationPreferences(db: Kysely<DB>) {
  return async (
    userId: string,
    prefs: { matchdayChannel: MatchdayChannel },
  ): Promise<{ matchdayChannel: MatchdayChannel }> => {
    await db
      .insertInto("notification_preferences")
      .values({
        user_id: userId,
        matchday_channel: prefs.matchdayChannel,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          matchday_channel: prefs.matchdayChannel,
          updated_at: new Date(),
        }),
      )
      .execute();

    return { matchdayChannel: prefs.matchdayChannel };
  };
}

// Batch read used by the notification dispatcher so it can fetch
// preferences for a recipient list in one query.
export function getNotificationPreferencesByUserIds(db: Kysely<DB>) {
  return async (userIds: string[]): Promise<Map<string, MatchdayChannel>> => {
    if (userIds.length === 0) return new Map();

    const rows = await db
      .selectFrom("notification_preferences")
      .select(["user_id", "matchday_channel"])
      .where("user_id", "in", userIds)
      .execute();

    return new Map(
      rows.map((r) => [r.user_id, r.matchday_channel as MatchdayChannel]),
    );
  };
}

export { DEFAULT_MATCHDAY_CHANNEL };
export type { matchdayChannelSchema };
