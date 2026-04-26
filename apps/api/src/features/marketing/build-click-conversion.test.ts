import { describe, expect, it } from "vitest";
import {
  buildClickConversion,
  type EventRowForBuild,
  type LeadRowForBuild,
} from "./build-click-conversion.ts";

const NOW = new Date("2026-04-25T12:00:00Z");
const RECENT = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

function makeEvent(
  overrides: Partial<EventRowForBuild> = {},
): EventRowForBuild {
  return {
    id: "evt_1",
    type: "lead_attended_session",
    campaign_id: "recruit-2026",
    segment: "senior_men_cricket",
    ads_conversion_action: "customers/0/conversionActions/1005",
    value_pence: 0,
    currency: "GBP",
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function makeLead(overrides: Partial<LeadRowForBuild> = {}): LeadRowForBuild {
  return {
    email: "alpha@example.com",
    attribution: { gclid: "abc", first_seen_at: RECENT },
    consent_ad_user_data: "granted",
    consent_ad_storage: "granted",
    ...overrides,
  };
}

describe("buildClickConversion (consent matrix)", () => {
  it("granted + gclid present → gclid payload, GRANTED consent", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead(),
      now: NOW,
    });
    expect(result.payload).toBeTruthy();
    expect(result.payload?.gclid).toBe("abc");
    expect(result.payload?.consent?.ad_user_data).toBe("GRANTED");
  });

  it("granted + no gclid → skip (no_match)", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({ attribution: { first_seen_at: RECENT } }),
      now: NOW,
    });
    expect(result.payload).toBeNull();
    expect(result.skipReason).toBe("no_match");
  });

  it("denied + gclid present → gclid payload, DENIED consent", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({ consent_ad_user_data: "denied" }),
      now: NOW,
    });
    expect(result.payload).toBeTruthy();
    expect(result.payload?.gclid).toBe("abc");
    expect(result.payload?.consent?.ad_user_data).toBe("DENIED");
  });

  it("denied + no gclid → skip", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({
        consent_ad_user_data: "denied",
        attribution: { first_seen_at: RECENT },
      }),
      now: NOW,
    });
    expect(result.payload).toBeNull();
    expect(result.skipReason).toBe("no_match");
  });

  it("unknown consent + gclid → gclid payload with UNSPECIFIED consent", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({ consent_ad_user_data: "unknown" }),
      now: NOW,
    });
    expect(result.payload).toBeTruthy();
    expect(result.payload?.gclid).toBe("abc");
    expect(result.payload?.consent?.ad_user_data).toBe("UNSPECIFIED");
  });

  it("unknown consent + no gclid → skip", () => {
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({
        consent_ad_user_data: "unknown",
        attribution: { first_seen_at: RECENT },
      }),
      now: NOW,
    });
    expect(result.payload).toBeNull();
    expect(result.skipReason).toBe("no_match");
  });

  it("past attribution window → skip", () => {
    const fourMonthsAgo = new Date(
      NOW.getTime() - 120 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = buildClickConversion({
      event: makeEvent(),
      lead: makeLead({
        attribution: { gclid: "abc", first_seen_at: fourMonthsAgo },
      }),
      now: NOW,
    });
    expect(result.payload).toBeNull();
    expect(result.skipReason).toBe("past_window");
  });

  it("missing conversion action → skip", () => {
    const result = buildClickConversion({
      event: makeEvent({ ads_conversion_action: null }),
      lead: makeLead(),
      now: NOW,
    });
    expect(result.payload).toBeNull();
    expect(result.skipReason).toBe("missing_action");
  });

  it("granted with became_member uses 5000 pence value", () => {
    const result = buildClickConversion({
      event: makeEvent({
        type: "lead_became_member",
        ads_conversion_action: "customers/0/conversionActions/1006",
        value_pence: 5000,
      }),
      lead: makeLead(),
      now: NOW,
    });
    expect(result.payload?.conversion_value).toBe(50);
    expect(result.payload?.currency_code).toBe("GBP");
  });
});
