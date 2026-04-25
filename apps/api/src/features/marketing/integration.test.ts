import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test/app.ts";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { emitMarketingEvent } from "./service.ts";

let ctx: TestContext;
let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  ctx = await startTestContainer();
  app = await buildTestApp(ctx.db, ctx.dialect);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await stopTestContainer(ctx);
});

describe("emitMarketingEvent (integration)", () => {
  it("creates a new lead, event, and outbox row for a generate_lead with mapped action", async () => {
    const result = await emitMarketingEvent(ctx.db)({
      type: "generate_lead",
      campaignId: "recruit-2026",
      segment: "senior_men_cricket",
      source: "browser",
      lead: {
        email: "alpha@example.com",
        name: "Alpha",
        source: "marketing_lead_form",
        consent: {
          ad_user_data: "granted",
          ad_storage: "granted",
          version: "2026-04-25",
          recordedAt: "2026-04-25T12:00:00Z",
        },
      },
    });

    expect(result.leadId).toBeTruthy();
    expect(result.eventId).toBeTruthy();
    expect(result.outboxId).toBeTruthy();

    const lead = await ctx.db
      .selectFrom("lead")
      .selectAll()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", result.leadId!)
      .executeTakeFirstOrThrow();
    expect(lead.first_campaign_id).toBe("recruit-2026");
    expect(lead.first_segment).toBe("senior_men_cricket");
    expect(lead.consent_ad_user_data).toBe("granted");
    expect(lead.status).toBe("new");

    const event = await ctx.db
      .selectFrom("marketing_event")
      .selectAll()
      .where("id", "=", result.eventId)
      .executeTakeFirstOrThrow();
    expect(event.type).toBe("generate_lead");
    expect(event.ads_conversion_action).toMatch(
      /conversionActions\/7588949430$/,
    );

    const outbox = await ctx.db
      .selectFrom("marketing_outbox")
      .selectAll()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", result.outboxId!)
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe("pending");
    expect(outbox.destination).toBe("google_ads");
  });

  it("reuses an existing lead by email and does not change first_campaign_id", async () => {
    const first = await emitMarketingEvent(ctx.db)({
      type: "generate_lead",
      campaignId: "recruit-2026",
      segment: "senior_men_cricket",
      source: "browser",
      lead: {
        email: "beta@example.com",
        name: "Beta",
        source: "marketing_lead_form",
      },
    });

    const second = await emitMarketingEvent(ctx.db)({
      type: "generate_lead",
      campaignId: "recruit-2026",
      segment: "junior_boys_cricket",
      source: "browser",
      lead: {
        email: "beta@example.com",
        name: "Beta",
        source: "marketing_lead_form",
      },
    });

    expect(second.leadId).toBe(first.leadId);
    const lead = await ctx.db
      .selectFrom("lead")
      .selectAll()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", first.leadId!)
      .executeTakeFirstOrThrow();
    expect(lead.first_campaign_id).toBe("recruit-2026");
    expect(lead.first_segment).toBe("senior_men_cricket");
  });

  it("does not create an outbox row when no conversion action is mapped", async () => {
    const result = await emitMarketingEvent(ctx.db)({
      type: "sign_up",
      source: "server",
      lead: {
        email: "gamma@example.com",
        name: "Gamma",
        source: "register",
      },
    });

    expect(result.outboxId).toBeNull();
    const outboxRows = await ctx.db
      .selectFrom("marketing_outbox")
      .selectAll()
      .where("event_id", "=", result.eventId)
      .execute();
    expect(outboxRows).toHaveLength(0);
  });

  it("denormalises lead.status from a funnel-relevant event", async () => {
    const seeded = await emitMarketingEvent(ctx.db)({
      type: "generate_lead",
      campaignId: "recruit-2026",
      segment: "senior_men_cricket",
      source: "browser",
      lead: {
        email: "delta@example.com",
        name: "Delta",
        source: "marketing_lead_form",
      },
    });

    await emitMarketingEvent(ctx.db)({
      type: "lead_contacted",
      source: "admin",
      leadId: seeded.leadId,
    });

    const lead = await ctx.db
      .selectFrom("lead")
      .selectAll()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
      .where("id", "=", seeded.leadId!)
      .executeTakeFirstOrThrow();
    expect(lead.status).toBe("contacted");
  });
});

describe("POST /api/marketing/leads (integration)", () => {
  const validBody = {
    campaignId: "recruit-2026",
    segment: "senior_men_cricket",
    name: "Test Lead",
    email: "test-lead@example.com",
    source: "marketing_lead_form",
    consent: {
      ad_user_data: "granted",
      ad_storage: "granted",
      version: "2026-04-25",
      recordedAt: "2026-04-25T12:00:00Z",
    },
  };

  it("accepts a valid submission and writes lead + event + outbox", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/marketing/leads",
      payload: validBody,
    });
    expect(response.statusCode).toBe(200);
    const body: { leadId: string } = response.json();
    expect(body.leadId).toBeTruthy();

    const lead = await ctx.db
      .selectFrom("lead")
      .selectAll()
      .where("id", "=", body.leadId)
      .executeTakeFirstOrThrow();
    expect(lead.email).toBe(validBody.email);
    expect(lead.first_campaign_id).toBe("recruit-2026");
  });

  it("returns 400 for an unknown campaignId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/marketing/leads",
      payload: {
        ...validBody,
        email: "unknown@example.com",
        campaignId: "nope",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("silently ignores honeypot-filled submissions (no DB writes)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/marketing/leads",
      payload: {
        ...validBody,
        email: "honeypot@example.com",
        honeypot: "I am a bot",
      },
    });
    expect(response.statusCode).toBe(200);
    const rows = await ctx.db
      .selectFrom("lead")
      .where("email", "=", "honeypot@example.com")
      .selectAll()
      .execute();
    expect(rows).toHaveLength(0);
  });

  it("rate-limits the same email after the threshold", async () => {
    const email = "rate-limited@example.com";
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/marketing/leads",
        payload: { ...validBody, email, name: `Rate ${i}` },
      });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });
});
