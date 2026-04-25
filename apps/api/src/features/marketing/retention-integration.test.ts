import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { runRetentionCleanup } from "./retention.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

async function seedMember(): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.db
    .insertInto("member")
    .values({
      id,
      name: "Test Member",
      email: `member-${id}@example.com`,
    })
    .execute();
  return id;
}

async function seedLead(opts: {
  email: string;
  ageDays: number;
  linked: boolean;
}) {
  const id = crypto.randomUUID();
  const createdAt = new Date(
    Date.now() - opts.ageDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const memberId = opts.linked ? await seedMember() : null;
  await ctx.db
    .insertInto("lead")
    .values({
      id,
      email: opts.email,
      source: "test",
      member_id: memberId,
      created_at: createdAt,
    })
    .execute();
  return id;
}

async function seedSucceededOutbox(opts: { ageDays: number }): Promise<string> {
  const evtId = crypto.randomUUID();
  await ctx.db
    .insertInto("marketing_event")
    .values({
      id: evtId,
      type: "lead_attended_session",
      source: "admin",
    })
    .execute();
  const outboxId = crypto.randomUUID();
  const succeededAt = new Date(
    Date.now() - opts.ageDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  await ctx.db
    .insertInto("marketing_outbox")
    .values({
      id: outboxId,
      event_id: evtId,
      destination: "google_ads",
      status: "succeeded",
      succeeded_at: succeededAt,
    })
    .execute();
  return outboxId;
}

describe("retention cleanup (integration)", () => {
  it("deletes unlinked leads older than 3 years; keeps younger and linked rows", async () => {
    const oldUnlinked = await seedLead({
      email: "old-unlinked@example.com",
      ageDays: 4 * 365,
      linked: false,
    });
    const oldLinked = await seedLead({
      email: "old-linked@example.com",
      ageDays: 4 * 365,
      linked: true,
    });
    const recentUnlinked = await seedLead({
      email: "recent-unlinked@example.com",
      ageDays: 30,
      linked: false,
    });

    const result = await runRetentionCleanup(ctx.db)();
    expect(result.leadsDeleted).toBeGreaterThanOrEqual(1);

    const oldUnlinkedRow = await ctx.db
      .selectFrom("lead")
      .where("id", "=", oldUnlinked)
      .selectAll()
      .executeTakeFirst();
    expect(oldUnlinkedRow).toBeUndefined();

    const oldLinkedRow = await ctx.db
      .selectFrom("lead")
      .where("id", "=", oldLinked)
      .selectAll()
      .executeTakeFirst();
    expect(oldLinkedRow).toBeTruthy();

    const recentRow = await ctx.db
      .selectFrom("lead")
      .where("id", "=", recentUnlinked)
      .selectAll()
      .executeTakeFirst();
    expect(recentRow).toBeTruthy();
  });

  it("prunes succeeded outbox rows older than 90 days; keeps recent rows", async () => {
    const oldOutbox = await seedSucceededOutbox({ ageDays: 120 });
    const recentOutbox = await seedSucceededOutbox({ ageDays: 30 });

    const result = await runRetentionCleanup(ctx.db)();
    expect(result.outboxRowsDeleted).toBeGreaterThanOrEqual(1);

    const oldRow = await ctx.db
      .selectFrom("marketing_outbox")
      .where("id", "=", oldOutbox)
      .selectAll()
      .executeTakeFirst();
    expect(oldRow).toBeUndefined();

    const recentRow = await ctx.db
      .selectFrom("marketing_outbox")
      .where("id", "=", recentOutbox)
      .selectAll()
      .executeTakeFirst();
    expect(recentRow).toBeTruthy();
  });

  it("dry-run reports counts without deleting", async () => {
    await seedLead({
      email: `dry-run-${Date.now()}@example.com`,
      ageDays: 4 * 365,
      linked: false,
    });

    const dry = await runRetentionCleanup(ctx.db)({ dryRun: true });
    expect(dry.leadsDeleted).toBeGreaterThan(0);
    const stillExists = await ctx.db
      .selectFrom("lead")
      .where("email", "like", "dry-run-%")
      .selectAll()
      .executeTakeFirst();
    expect(stillExists).toBeTruthy();
  });
});
