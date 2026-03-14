import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { purchaseSchema, subscribeSchema } from "./schemas.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("payments (integration)", () => {
  describe("purchaseSchema validation", () => {
    it("accepts a valid purchase with priceId only", () => {
      const result = purchaseSchema.safeParse({ priceId: "price_abc123" });
      expect(result.success).toBe(true);
    });

    it("accepts a purchase with optional fields", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        quantity: 2,
        customAmountPence: 5000,
        metadata: { orderId: "ord-1" },
        email: "buyer@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing priceId", () => {
      const result = purchaseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        email: "not-an-email",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive quantity", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        quantity: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer customAmountPence", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        customAmountPence: 49.99,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("subscribeSchema validation", () => {
    it("accepts a valid subscription", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "senior_player",
        email: "member@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all valid membership types", () => {
      const types = [
        "social",
        "senior_player",
        "senior_women_player",
        "concessionary",
      ] as const;
      for (const membership of types) {
        const result = subscribeSchema.safeParse({
          priceId: "price_sub123",
          membership,
          email: "member@example.com",
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid membership type", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "invalid_type",
        email: "member@example.com",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing email", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "social",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing priceId", () => {
      const result = subscribeSchema.safeParse({
        membership: "social",
        email: "member@example.com",
      });
      expect(result.success).toBe(false);
    });
  });
});
