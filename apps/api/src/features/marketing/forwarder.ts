import type { DB } from "@percy-main/db";
import type { MarketingEventType } from "@percy-main/shared/marketing";
import type { FastifyBaseLogger } from "fastify";
import { sql, type Kysely } from "kysely";
import {
  AdsValidationError,
  isNoopAdsClient,
  type AdsClient,
} from "./ads-client.ts";
import { buildClickConversion } from "./build-click-conversion.ts";

const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 1440] as const;
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;
const BATCH_SIZE = 20;
const TICK_INTERVAL_MS = 30_000;

function nextAttemptAt(attempts: number): Date {
  const idx = Math.min(attempts, BACKOFF_MINUTES.length - 1);
  const minutes = BACKOFF_MINUTES[idx];
  return new Date(Date.now() + minutes * 60_000);
}

interface DrainDeps {
  db: Kysely<DB>;
  client: AdsClient;
  log: FastifyBaseLogger;
}

interface DrainOnceResult {
  picked: number;
  succeeded: number;
  skipped: number;
  retried: number;
  dead: number;
}

export async function drainOnce(deps: DrainDeps): Promise<DrainOnceResult> {
  const { db, client, log } = deps;
  if (isNoopAdsClient(client)) {
    return { picked: 0, succeeded: 0, skipped: 0, retried: 0, dead: 0 };
  }

  const result: DrainOnceResult = {
    picked: 0,
    succeeded: 0,
    skipped: 0,
    retried: 0,
    dead: 0,
  };

  await db.transaction().execute(async (trx) => {
    // Lock a batch of due, pending rows.
    const rows = await trx
      .selectFrom("marketing_outbox")
      .innerJoin(
        "marketing_event",
        "marketing_event.id",
        "marketing_outbox.event_id",
      )
      .leftJoin("lead", "lead.id", "marketing_event.lead_id")
      .where("marketing_outbox.status", "=", "pending")
      .where(
        "marketing_outbox.next_attempt_at",
        "<=",
        sql<string>`CURRENT_TIMESTAMP::text`,
      )
      .where("marketing_outbox.destination", "=", "google_ads")
      .select([
        "marketing_outbox.id as outbox_id",
        "marketing_outbox.attempts",
        "marketing_event.id as event_id",
        "marketing_event.type as event_type",
        "marketing_event.campaign_id",
        "marketing_event.segment",
        "marketing_event.ads_conversion_action",
        "marketing_event.value_pence",
        "marketing_event.currency",
        "marketing_event.created_at as event_created_at",
        "lead.email as lead_email",
        "lead.attribution as lead_attribution",
        "lead.consent_ad_user_data",
        "lead.consent_ad_storage",
      ])
      .orderBy("marketing_outbox.next_attempt_at", "asc")
      .limit(BATCH_SIZE)
      .modifyEnd(sql`FOR UPDATE OF marketing_outbox SKIP LOCKED`)
      .execute();

    result.picked = rows.length;
    if (rows.length === 0) return;

    // Build payloads + decide skip vs upload per row.
    const uploads: Array<{
      outboxId: string;
      payload: NonNullable<ReturnType<typeof buildClickConversion>["payload"]>;
    }> = [];
    const skips: Array<{ outboxId: string; reason: string }> = [];

    for (const r of rows) {
      const built = buildClickConversion({
        event: {
          id: r.event_id,
          type: r.event_type as MarketingEventType,
          campaign_id: r.campaign_id,
          segment: r.segment,
          ads_conversion_action: r.ads_conversion_action,
          value_pence: r.value_pence,
          currency: r.currency,
          created_at: r.event_created_at,
        },
        lead: r.lead_email
          ? {
              email: r.lead_email,
              attribution: r.lead_attribution,
              consent_ad_user_data: r.consent_ad_user_data ?? "unknown",
              consent_ad_storage: r.consent_ad_storage ?? "unknown",
            }
          : null,
      });

      if (!built.payload) {
        skips.push({
          outboxId: r.outbox_id,
          reason: built.skipReason ?? "skipped",
        });
      } else {
        uploads.push({ outboxId: r.outbox_id, payload: built.payload });
      }
    }

    // Mark skipped rows succeeded with reason recorded.
    for (const s of skips) {
      await trx
        .updateTable("marketing_outbox")
        .set({
          status: "succeeded",
          succeeded_at: new Date().toISOString(),
          last_error: `skipped:${s.reason}`,
        })
        .where("id", "=", s.outboxId)
        .execute();
      result.skipped += 1;
    }

    if (uploads.length === 0) return;

    // Upload in one batch. The SDK accepts a list and we already filtered
    // the destination to google_ads above.
    try {
      await client.uploadClickConversions(uploads.map((u) => u.payload));
      const now = new Date().toISOString();
      for (const u of uploads) {
        await trx
          .updateTable("marketing_outbox")
          .set({
            status: "succeeded",
            succeeded_at: now,
            last_error: null,
          })
          .where("id", "=", u.outboxId)
          .execute();
        result.succeeded += 1;
      }
    } catch (err) {
      if (err instanceof AdsValidationError) {
        // Validation failure — terminal for the entire batch. We don't
        // know per-row which one failed without partial-failure parsing,
        // so the safest default is dead-letter the whole batch and let
        // an admin review.
        for (const u of uploads) {
          await trx
            .updateTable("marketing_outbox")
            .set({
              status: "dead",
              attempts: sql`attempts + 1`,
              last_error: err.message,
            })
            .where("id", "=", u.outboxId)
            .execute();
          result.dead += 1;
        }
      } else {
        // Transient — back off and retry, dead-letter after MAX_ATTEMPTS.
        const errMessage = err instanceof Error ? err.message : String(err);
        for (const u of uploads) {
          const nextAttempts =
            (rows.find((r) => r.outbox_id === u.outboxId)?.attempts ?? 0) + 1;
          if (nextAttempts >= MAX_ATTEMPTS) {
            await trx
              .updateTable("marketing_outbox")
              .set({
                status: "dead",
                attempts: nextAttempts,
                last_error: errMessage,
              })
              .where("id", "=", u.outboxId)
              .execute();
            result.dead += 1;
          } else {
            await trx
              .updateTable("marketing_outbox")
              .set({
                attempts: nextAttempts,
                next_attempt_at: nextAttemptAt(nextAttempts).toISOString(),
                last_error: errMessage,
              })
              .where("id", "=", u.outboxId)
              .execute();
            result.retried += 1;
          }
        }
        log.warn(
          { err: errMessage, retried: result.retried, dead: result.dead },
          "Marketing outbox transient upload failure",
        );
      }
    }
  });

  return result;
}

interface ForwarderHandle {
  stop(): void;
}

/**
 * Starts the periodic drain loop. Returns a handle that lets the caller
 * stop it on graceful shutdown. No-op when env vars are missing (the
 * Ads client is a NoopAdsClient and drainOnce returns immediately).
 */
export function startForwarder(deps: DrainDeps): ForwarderHandle {
  if (isNoopAdsClient(deps.client)) {
    deps.log.info("Marketing forwarder: Ads creds absent — skipping interval");
    return { stop: () => undefined };
  }

  const tick = () => {
    drainOnce(deps).catch((err: unknown) => {
      deps.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "Marketing forwarder tick failed",
      );
    });
  };

  const handle = setInterval(tick, TICK_INTERVAL_MS);
  // Run once immediately on boot so we don't wait 30s for the first drain.
  tick();
  return {
    stop: () => clearInterval(handle),
  };
}
