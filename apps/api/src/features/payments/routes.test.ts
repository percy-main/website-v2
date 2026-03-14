import { describe, it, expect } from "vitest";
import {
  purchaseSchema,
  subscribeSchema,
} from "./schemas.js";
import {
  leaderboardQuerySchema,
} from "../leaderboard/schemas.js";

describe("payments schemas", () => {
  describe("purchaseSchema", () => {
    it("validates with required priceId", () => {
      const result = purchaseSchema.safeParse({ priceId: "price_123" });
      expect(result.success).toBe(true);
    });

    it("rejects missing priceId", () => {
      const result = purchaseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts optional fields", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_123",
        quantity: 2,
        customAmountPence: 1500,
        metadata: { event: "gala" },
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(2);
        expect(result.data.customAmountPence).toBe(1500);
      }
    });

    it("rejects invalid email", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_123",
        email: "not-an-email",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive quantity", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_123",
        quantity: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("subscribeSchema", () => {
    it("validates correct membership types", () => {
      const memberships = [
        "social",
        "senior_player",
        "senior_women_player",
        "concessionary",
      ] as const;

      for (const membership of memberships) {
        const result = subscribeSchema.safeParse({
          priceId: "price_sub_123",
          membership,
          email: "member@test.com",
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid membership type", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub_123",
        membership: "platinum",
        email: "member@test.com",
      });
      expect(result.success).toBe(false);
    });

    it("requires email", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub_123",
        membership: "social",
      });
      expect(result.success).toBe(false);
    });

    it("requires priceId", () => {
      const result = subscribeSchema.safeParse({
        membership: "social",
        email: "member@test.com",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("leaderboard query schema", () => {
  it("coerces limit from string to number", () => {
    const result = leaderboardQuerySchema.safeParse({
      game: "be-the-keeper",
      limit: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("applies default limit of 5", () => {
    const result = leaderboardQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
      expect(result.data.game).toBe("be-the-keeper");
    }
  });

  it("rejects limit above 50", () => {
    const result = leaderboardQuerySchema.safeParse({
      limit: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects limit below 1", () => {
    const result = leaderboardQuerySchema.safeParse({
      limit: "0",
    });
    expect(result.success).toBe(false);
  });
});
