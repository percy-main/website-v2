import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { createContactSubmission, createEventSubscriber } from "./service.ts";

const log = createNoopLogger();

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("contact service (integration)", () => {
  describe("createContactSubmission", () => {
    it("stores a submission in the database and returns an id", async () => {
      const result = await createContactSubmission(ctx.db, {
        slackWebhookUrl: undefined,
      })(
        {
          name: "Jane Doe",
          email: "jane@example.com",
          message: "Hello, I have a question.",
          page: "/contact",
        },
        log,
      );

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");

      const row = await ctx.db
        .selectFrom("contact_submission")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();

      expect(row).toBeTruthy();
      expect(row?.name).toBe("Jane Doe");
      expect(row?.email).toBe("jane@example.com");
      expect(row?.message).toBe("Hello, I have a question.");
      expect(row?.page).toBe("/contact");
    });
  });

  describe("createEventSubscriber", () => {
    it("stores a subscriber with JSON meta in the database", async () => {
      const meta = { event: "summer-camp", year: 2026 };
      const result = await createEventSubscriber(ctx.db)({
        email: "subscriber@example.com",
        meta,
      });

      expect(result.id).toBeDefined();

      const row = await ctx.db
        .selectFrom("event_subscriber")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();

      expect(row).toBeTruthy();
      expect(row?.email).toBe("subscriber@example.com");

      const storedMeta =
        typeof row?.meta === "string"
          ? (JSON.parse(row.meta) as Record<string, unknown>)
          : (row?.meta as Record<string, unknown> | undefined);
      expect(storedMeta?.event).toBe("summer-camp");
      expect(storedMeta?.year).toBe(2026);
    });
  });
});
