import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  seedTestUser,
  type TestContext,
} from "../../test/containers.js";
import { getMyCharges, confirmPayment } from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("charges service (integration)", () => {
  describe("getMyCharges", () => {
    it("returns empty array for a user with no member record", async () => {
      const result = await getMyCharges(ctx.db)("nonexistent@test.com");
      expect(result).toEqual([]);
    });

    it("returns charges ordered by date descending", async () => {
      const email = `charges-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      // Insert charges with different dates
      await ctx.db
        .insertInto("charge")
        .values([
          {
            id: `ch-old-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "Old charge",
            amount_pence: 1000,
            charge_date: "2025-01-01",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
          {
            id: `ch-new-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "New charge",
            amount_pence: 2000,
            charge_date: "2026-03-01",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
          {
            id: `ch-mid-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "Mid charge",
            amount_pence: 1500,
            charge_date: "2025-06-15",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
        ])
        .execute();

      const result = await getMyCharges(ctx.db)(email);

      expect(result).toHaveLength(3);
      expect(result[0].description).toBe("New charge");
      expect(result[1].description).toBe("Mid charge");
      expect(result[2].description).toBe("Old charge");
    });

    it("excludes soft-deleted charges", async () => {
      const email = `deleted-charges-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const activeId = `ch-active-${crypto.randomUUID()}`;
      const deletedId = `ch-deleted-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("charge")
        .values([
          {
            id: activeId,
            member_id: memberId ?? "",
            description: "Active charge",
            amount_pence: 1000,
            charge_date: "2026-01-01",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
          {
            id: deletedId,
            member_id: memberId ?? "",
            description: "Deleted charge",
            amount_pence: 2000,
            charge_date: "2026-02-01",
            created_by: "system",
            type: "manual",
            source: "admin",
            deleted_at: new Date().toISOString(),
          },
        ])
        .execute();

      const result = await getMyCharges(ctx.db)(email);

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe("Active charge");
    });
  });

  describe("confirmPayment", () => {
    it("updates matching unpaid charges with a payment confirmation", async () => {
      const email = `confirm-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const chargeId = `ch-confirm-${crypto.randomUUID()}`;
      const paymentIntentId = `pi_${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId ?? "",
          description: "Match fee",
          amount_pence: 1500,
          charge_date: "2026-03-01",
          created_by: "system",
          type: "match_fee",
          source: "website",
          stripe_payment_intent_id: paymentIntentId,
        })
        .execute();

      await confirmPayment(ctx.db)(email, paymentIntentId);

      const charges = await getMyCharges(ctx.db)(email);
      const updated = charges.find((c) => c.id === chargeId);

      expect(updated).toBeTruthy();
      expect(updated?.payment_confirmed_at).toBeTruthy();
    });
  });
});
