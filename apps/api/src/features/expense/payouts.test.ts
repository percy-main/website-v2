import { describe, expect, it } from "vitest";
import { createPayoutsClient, mapOutboundPaymentEvent } from "./payouts.ts";

describe("mapOutboundPaymentEvent", () => {
  it("maps posted/paid events to paid", () => {
    expect(
      mapOutboundPaymentEvent("v2.money_management.outbound_payment.posted"),
    ).toBe("paid");
    expect(
      mapOutboundPaymentEvent("v2.money_management.outbound_payment.paid"),
    ).toBe("paid");
  });

  it("maps failed/returned/canceled events to payout_failed", () => {
    for (const suffix of ["failed", "returned", "canceled"]) {
      expect(
        mapOutboundPaymentEvent(
          `v2.money_management.outbound_payment.${suffix}`,
        ),
      ).toBe("payout_failed");
    }
  });

  it("ignores unrelated or non-terminal events", () => {
    expect(
      mapOutboundPaymentEvent("v2.money_management.outbound_payment.created"),
    ).toBeNull();
    expect(mapOutboundPaymentEvent("v1.payment_intent.succeeded")).toBeNull();
  });
});

describe("createPayoutsClient", () => {
  it("returns null when the financial account or version is missing", () => {
    expect(createPayoutsClient({ stripeSecretKey: "sk_test_x" })).toBeNull();
    expect(
      createPayoutsClient({
        stripeSecretKey: "sk_test_x",
        financialAccountId: "fa_123",
      }),
    ).toBeNull();
  });

  it("returns a client when fully configured", () => {
    expect(
      createPayoutsClient({
        stripeSecretKey: "sk_test_x",
        financialAccountId: "fa_123",
        apiVersion: "2026-05-27.preview",
      }),
    ).not.toBeNull();
  });
});
