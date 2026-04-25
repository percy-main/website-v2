import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";

export interface RetentionResult {
  leadsDeleted: number;
  outboxRowsDeleted: number;
}

/**
 * Enforces the retention policy committed in the privacy notice:
 *
 * - Unlinked `lead` rows (no member_id) older than 3 years are deleted;
 *   FK ON DELETE CASCADE removes the matching marketing_event and
 *   marketing_outbox rows.
 * - `marketing_outbox` rows in `succeeded` state older than 90 days are
 *   pruned to keep the outbox table small.
 * - Linked leads inherit the member's retention - we leave them alone.
 *
 * Designed to be safe to run multiple times; no-op when nothing matches.
 */
export function runRetentionCleanup(db: Kysely<DB>) {
  return async (
    opts: {
      leadAgeDays?: number;
      outboxAgeDays?: number;
      dryRun?: boolean;
    } = {},
  ): Promise<RetentionResult> => {
    const leadAgeDays = opts.leadAgeDays ?? 3 * 365;
    const outboxAgeDays = opts.outboxAgeDays ?? 90;
    const dryRun = opts.dryRun ?? false;

    return db.transaction().execute(async (trx) => {
      const leadCutoff = sql<string>`(CURRENT_TIMESTAMP - (${leadAgeDays} || ' days')::interval)::text`;
      const outboxCutoff = sql<string>`(CURRENT_TIMESTAMP - (${outboxAgeDays} || ' days')::interval)::text`;

      const leadsToDelete = await trx
        .selectFrom("lead")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("member_id", "is", null)
        .where("created_at", "<", leadCutoff)
        .executeTakeFirstOrThrow();

      const outboxToDelete = await trx
        .selectFrom("marketing_outbox")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("status", "=", "succeeded")
        .where("succeeded_at", "<", outboxCutoff)
        .executeTakeFirstOrThrow();

      if (dryRun) {
        return {
          leadsDeleted: Number(leadsToDelete.c),
          outboxRowsDeleted: Number(outboxToDelete.c),
        };
      }

      // Cascade FK on lead → marketing_event + marketing_outbox handles
      // the dependents.
      await trx
        .deleteFrom("lead")
        .where("member_id", "is", null)
        .where("created_at", "<", leadCutoff)
        .execute();

      await trx
        .deleteFrom("marketing_outbox")
        .where("status", "=", "succeeded")
        .where("succeeded_at", "<", outboxCutoff)
        .execute();

      return {
        leadsDeleted: Number(leadsToDelete.c),
        outboxRowsDeleted: Number(outboxToDelete.c),
      };
    });
  };
}
