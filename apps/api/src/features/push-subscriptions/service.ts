import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function upsertPushSubscription(db: Kysely<DB>) {
  return async (
    userId: string,
    input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ): Promise<{ id: string }> => {
    // endpoint is globally unique (each PushManager.subscribe() yields a
    // distinct one). If the same browser re-subscribes we want to refresh
    // the row in place rather than fail on the unique constraint, and we
    // want to re-key it onto whoever is currently signed in - a shared
    // device legitimately rotates users.
    const row = await db
      .insertInto("push_subscription")
      .values({
        user_id: userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        user_agent: input.userAgent ?? null,
      })
      .onConflict((oc) =>
        oc.column("endpoint").doUpdateSet({
          user_id: userId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          user_agent: input.userAgent ?? null,
          updated_at: new Date(),
        }),
      )
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return { id: row.id };
  };
}

export function deletePushSubscription(db: Kysely<DB>) {
  return async (
    userId: string,
    endpoint: string,
  ): Promise<{ deleted: boolean }> => {
    const result = await db
      .deleteFrom("push_subscription")
      .where("user_id", "=", userId)
      .where("endpoint", "=", endpoint)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) > 0 };
  };
}

export function listPushSubscriptionsForUsers(db: Kysely<DB>) {
  return async (
    userIds: string[],
  ): Promise<Map<string, StoredPushSubscription[]>> => {
    if (userIds.length === 0) return new Map();

    const rows = await db
      .selectFrom("push_subscription")
      .select(["id", "user_id", "endpoint", "p256dh", "auth"])
      .where("user_id", "in", userIds)
      .execute();

    const byUser = new Map<string, StoredPushSubscription[]>();
    for (const row of rows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push({
        id: row.id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
      });
      byUser.set(row.user_id, list);
    }
    return byUser;
  };
}

// Used by the push dispatcher when the push service returns 404/410 -
// the subscription is dead and should never be tried again.
export function deletePushSubscriptionByEndpoint(db: Kysely<DB>) {
  return async (endpoint: string): Promise<void> => {
    await db
      .deleteFrom("push_subscription")
      .where("endpoint", "=", endpoint)
      .execute();
  };
}
