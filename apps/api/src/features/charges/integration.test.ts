import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  confirmPayment,
  getMyCharges,
  payOutstandingCharges,
} from "./service.ts";

const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();
const mockStripe = {
  paymentIntents: {
    create: mockPaymentIntentsCreate,
    retrieve: mockPaymentIntentsRetrieve,
  },
} as unknown as Stripe;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

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

  describe("payOutstandingCharges", () => {
    it("throws when no member exists", async () => {
      await expect(
        payOutstandingCharges(ctx.db, mockStripe)("nonexistent@test.com"),
      ).rejects.toThrow("No member record found");
    });

    it("throws when no unpaid charges exist", async () => {
      const email = `no-unpaid-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      await expect(
        payOutstandingCharges(ctx.db, mockStripe)(email),
      ).rejects.toThrow("No unpaid charges found");
    });

    it("creates a payment intent and links charges", async () => {
      const email = `pay-outstanding-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const chargeId1 = `ch-pay-${crypto.randomUUID()}`;
      const chargeId2 = `ch-pay-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("charge")
        .values([
          {
            id: chargeId1,
            member_id: memberId ?? "",
            description: "Match fee 1",
            amount_pence: 1000,
            charge_date: "2026-03-01",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
          {
            id: chargeId2,
            member_id: memberId ?? "",
            description: "Match fee 2",
            amount_pence: 1500,
            charge_date: "2026-03-08",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
        ])
        .execute();

      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_test_123",
        client_secret: "pi_test_123_secret_abc",
      } as never);

      const result = await payOutstandingCharges(ctx.db, mockStripe)(email);

      expect(result.totalAmountPence).toBe(2500);
      expect(result.clientSecret).toBe("pi_test_123_secret_abc");
      expect(result.chargeIds).toHaveLength(2);
      expect(result.chargeIds).toContain(chargeId1);
      expect(result.chargeIds).toContain(chargeId2);

      // Verify charges are linked to the payment intent
      const charges = await getMyCharges(ctx.db)(email);
      const linked = charges.filter(
        (c) => c.stripe_payment_intent_id === "pi_test_123",
      );
      expect(linked).toHaveLength(2);
    });

    it("excludes already-paid and already-linked charges", async () => {
      const email = `exclude-paid-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      await ctx.db
        .insertInto("charge")
        .values([
          {
            id: `ch-unpaid-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "Unpaid charge",
            amount_pence: 500,
            charge_date: "2026-03-01",
            created_by: "system",
            type: "manual",
            source: "admin",
          },
          {
            id: `ch-paid-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "Already paid",
            amount_pence: 2000,
            charge_date: "2026-02-01",
            created_by: "system",
            type: "manual",
            source: "admin",
            paid_at: new Date().toISOString(),
          },
          {
            id: `ch-linked-${crypto.randomUUID()}`,
            member_id: memberId ?? "",
            description: "Already linked to PI",
            amount_pence: 3000,
            charge_date: "2026-02-15",
            created_by: "system",
            type: "manual",
            source: "admin",
            stripe_payment_intent_id: "pi_existing",
          },
        ])
        .execute();

      // The linked charge's PI is still active — should stay excluded
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_existing",
        status: "requires_confirmation",
      } as never);

      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_new_456",
        client_secret: "pi_new_456_secret",
      } as never);

      const result = await payOutstandingCharges(ctx.db, mockStripe)(email);

      // Only the unpaid, unlinked charge should be included
      expect(result.totalAmountPence).toBe(500);
      expect(result.chargeIds).toHaveLength(1);

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500,
          currency: "gbp",
        }),
      );
    });

    it("scopes to the supplied chargeIds when provided (#93)", async () => {
      const email = `scoped-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const targetId = `ch-target-${crypto.randomUUID()}`;
      const otherId = `ch-other-${crypto.randomUUID()}`;

      await ctx.db
        .insertInto("charge")
        .values([
          {
            id: targetId,
            member_id: memberId ?? "",
            description: "Junior signup just created",
            amount_pence: 4000,
            charge_date: "2026-05-01",
            created_by: "system",
            type: "junior_membership",
            source: "website",
          },
          {
            id: otherId,
            member_id: memberId ?? "",
            description: "Parent's own outstanding fee",
            amount_pence: 9000,
            charge_date: "2026-04-01",
            created_by: "system",
            type: "membership",
            source: "admin",
          },
        ])
        .execute();

      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_scoped_789",
        client_secret: "pi_scoped_789_secret",
      } as never);

      const result = await payOutstandingCharges(ctx.db, mockStripe)(email, [
        targetId,
      ]);

      expect(result.chargeIds).toEqual([targetId]);
      expect(result.totalAmountPence).toBe(4000);

      const charges = await getMyCharges(ctx.db)(email);
      const other = charges.find((c) => c.id === otherId);
      expect(other?.stripe_payment_intent_id).toBeNull();
    });

    it("ignores chargeIds belonging to a different member", async () => {
      const email = `safety-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email });

      const otherEmail = `other-${crypto.randomUUID()}@test.com`;
      const { memberId: otherMemberId } = await seedTestUser(ctx.db, {
        email: otherEmail,
      });
      const otherChargeId = `ch-foreign-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("charge")
        .values({
          id: otherChargeId,
          member_id: otherMemberId ?? "",
          description: "Foreign charge",
          amount_pence: 5000,
          charge_date: "2026-04-01",
          created_by: "system",
          type: "manual",
          source: "admin",
        })
        .execute();

      await expect(
        payOutstandingCharges(ctx.db, mockStripe)(email, [otherChargeId]),
      ).rejects.toThrow("No unpaid charges found");
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
