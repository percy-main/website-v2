import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  AdsTransientError,
  AdsValidationError,
  type AdsClient,
  type ClickConversionPayload,
} from "./ads-client.ts";
import { drainOnce } from "./forwarder.ts";
import { emitMarketingEvent } from "./service.ts";

let ctx: TestContext;

const fakeLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof drainOnce>[0]["log"];

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

class StubClient implements AdsClient {
  public uploadedBatches: ClickConversionPayload[][] = [];
  constructor(
    private readonly behaviour: "ok" | "validation" | "transient" = "ok",
  ) {}
  async uploadClickConversions(payloads: ClickConversionPayload[]) {
    this.uploadedBatches.push(payloads);
    if (this.behaviour === "validation") {
      throw new AdsValidationError("invalid conversion action");
    }
    if (this.behaviour === "transient") {
      throw new AdsTransientError("upstream 503");
    }
    await Promise.resolve();
  }
}

async function seedReadyOutboxRow(opts: {
  email: string;
  consent: "granted" | "denied";
  gclid?: string;
}) {
  const result = await emitMarketingEvent(ctx.db)({
    type: "lead_attended_session",
    campaignId: "recruit-2026",
    segment: "senior_men_cricket",
    source: "admin",
    lead: {
      email: opts.email,
      name: "Forwarder Test",
      source: "marketing_lead_form",
      consent: {
        ad_user_data: opts.consent,
        ad_storage: opts.consent,
        version: "2026-04-25",
        recordedAt: "2026-04-25T12:00:00Z",
      },
    },
    attribution: opts.gclid
      ? {
          gclid: opts.gclid,
          first_seen_at: new Date(
            Date.now() - 5 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        }
      : undefined,
  });
  // emitMarketingEvent stamps attribution onto the lead's first_seen_at
  // only via the lead.attribution column, but since lead_attended_session
  // doesn't go through the upsert path the attribution may be missing.
  // Patch it so the past-window check has data to work with.
  if (result.leadId && opts.gclid) {
    await ctx.db
      .updateTable("lead")
      .set({
        attribution: JSON.stringify({
          gclid: opts.gclid,
          first_seen_at: new Date(
            Date.now() - 5 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        }),
      })
      .where("id", "=", result.leadId)
      .execute();
  }
  return result;
}

describe("drainOnce state machine", () => {
  it("transitions pending -> succeeded on OK", async () => {
    const seeded = await seedReadyOutboxRow({
      email: "drain-ok@example.com",
      consent: "granted",
      gclid: "ok_gclid",
    });
    const client = new StubClient("ok");
    const summary = await drainOnce({ db: ctx.db, client, log: fakeLog });
    expect(summary.succeeded).toBeGreaterThan(0);
    const outbox = await ctx.db
      .selectFrom("marketing_outbox")
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", seeded.outboxId!)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe("succeeded");
    expect(outbox.succeeded_at).toBeTruthy();
  });

  it("transitions pending -> dead on validation error", async () => {
    const seeded = await seedReadyOutboxRow({
      email: "drain-validation@example.com",
      consent: "granted",
      gclid: "val_gclid",
    });
    const client = new StubClient("validation");
    await drainOnce({ db: ctx.db, client, log: fakeLog });
    const outbox = await ctx.db
      .selectFrom("marketing_outbox")
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", seeded.outboxId!)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe("dead");
    expect(outbox.last_error).toContain("invalid conversion action");
  });

  it("transitions pending -> retry-pending on transient error and increments attempts", async () => {
    const seeded = await seedReadyOutboxRow({
      email: "drain-transient@example.com",
      consent: "granted",
      gclid: "tr_gclid",
    });
    const client = new StubClient("transient");
    await drainOnce({ db: ctx.db, client, log: fakeLog });
    const outbox = await ctx.db
      .selectFrom("marketing_outbox")
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", seeded.outboxId!)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe("pending");
    expect(outbox.attempts).toBe(1);
    expect(new Date(outbox.next_attempt_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(outbox.last_error).toContain("upstream 503");
  });

  it("skips a denied-consent + no-gclid row with reason recorded", async () => {
    const seeded = await seedReadyOutboxRow({
      email: "drain-skip@example.com",
      consent: "denied",
      // intentionally no gclid
    });
    const client = new StubClient("ok");
    const summary = await drainOnce({ db: ctx.db, client, log: fakeLog });
    expect(summary.skipped).toBeGreaterThan(0);
    expect(client.uploadedBatches).toEqual([]);
    const outbox = await ctx.db
      .selectFrom("marketing_outbox")
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", seeded.outboxId!)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe("succeeded");
    expect(outbox.last_error).toMatch(/^skipped:/);
  });
});
