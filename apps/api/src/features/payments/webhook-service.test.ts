import {
  gameSponsoredSchema,
  membershipSchema,
  playerSponsoredSchema,
} from "@percy-main/shared";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { invoiceLinesToDuration, stripeDate } from "./stripe-utils.ts";

// Mock email sending to avoid side effects in unit tests
vi.mock("@percy-main/email", () => ({
  send: vi.fn().mockResolvedValue(undefined),
  MembershipUpdated: { subject: "Membership Updated", component: vi.fn() },
  SponsorshipConfirmation: {
    subject: "Sponsorship Confirmation",
    component: vi.fn(),
  },
  PlayerSponsorshipConfirmation: {
    subject: "Player Sponsorship Confirmation",
    component: vi.fn(),
  },
}));

vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

describe("stripe-utils", () => {
  describe("stripeDate", () => {
    it("converts Stripe Unix timestamp (seconds) to Date", () => {
      const timestamp = 1700000000; // 2023-11-14T22:13:20Z
      const result = stripeDate(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(1700000000000);
    });

    it("handles zero timestamp", () => {
      expect(stripeDate(0).getTime()).toBe(0);
    });
  });

  describe("invoiceLinesToDuration", () => {
    it("returns 12 months (1 year) for one-time price", () => {
      const lineItems = [
        { price: { type: "one_time" as const } },
      ] as unknown as Stripe.LineItem[];
      const result = invoiceLinesToDuration(lineItems);
      // 12 months normalises to 1 year via date-fns intervalToDuration
      expect(result.years).toBe(1);
    });

    it("returns recurring interval for recurring price", () => {
      const lineItems = [
        {
          price: {
            type: "recurring" as const,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ] as unknown as Stripe.LineItem[];
      const result = invoiceLinesToDuration(lineItems);
      expect(result.months).toBe(1);
    });

    it("returns zero duration for unknown price type", () => {
      const lineItems = [
        { price: { type: "unknown" } },
      ] as unknown as Stripe.LineItem[];
      const result = invoiceLinesToDuration(lineItems);
      expect(result.years ?? 0).toBe(0);
      expect(result.months ?? 0).toBe(0);
    });

    it("sums durations from multiple line items", () => {
      const lineItems = [
        { price: { type: "one_time" as const } }, // 12 months
        {
          price: {
            type: "recurring" as const,
            recurring: { interval: "month", interval_count: 3 },
          },
        }, // 3 months
      ] as unknown as Stripe.LineItem[];
      const result = invoiceLinesToDuration(lineItems);
      // 12 + 3 = 15 months = 1 year 3 months
      expect(result.years).toBe(1);
      expect(result.months).toBe(3);
    });

    it("handles empty line items", () => {
      const result = invoiceLinesToDuration([]);
      expect(result.years ?? 0).toBe(0);
      expect(result.months ?? 0).toBe(0);
    });

    it("handles null price gracefully", () => {
      const lineItems = [{ price: null }] as unknown as Stripe.LineItem[];
      const result = invoiceLinesToDuration(lineItems);
      expect(result.years ?? 0).toBe(0);
      expect(result.months ?? 0).toBe(0);
    });
  });
});

describe("webhook metadata parsing", () => {
  describe("game sponsorship", () => {
    it("parses valid game sponsorship metadata", () => {
      const result = gameSponsoredSchema.safeParse({
        type: "sponsorGame",
        gameId: "123",
        sponsorshipId: "sp_456",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gameId).toBe("123");
        expect(result.data.sponsorshipId).toBe("sp_456");
      }
    });

    it("rejects without gameId", () => {
      const result = gameSponsoredSchema.safeParse({
        type: "sponsorGame",
      });
      expect(result.success).toBe(false);
    });

    it("accepts without optional sponsorshipId", () => {
      const result = gameSponsoredSchema.safeParse({
        type: "sponsorGame",
        gameId: "123",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("player sponsorship", () => {
    it("parses valid player sponsorship metadata", () => {
      const result = playerSponsoredSchema.safeParse({
        type: "sponsorPlayer",
        slug: "entry_789",
        sponsorshipId: "sp_012",
      });
      expect(result.success).toBe(true);
    });

    it("rejects without sponsorshipId", () => {
      const result = playerSponsoredSchema.safeParse({
        type: "sponsorPlayer",
        slug: "entry_789",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("membership", () => {
    it("parses all valid membership types", () => {
      for (const membership of [
        "social",
        "senior_player",
        "senior_women_player",
        "concessionary",
      ]) {
        const result = membershipSchema.safeParse({
          type: "membership",
          membership,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid membership type", () => {
      const result = membershipSchema.safeParse({
        type: "membership",
        membership: "platinum",
      });
      expect(result.success).toBe(false);
    });
  });
});
