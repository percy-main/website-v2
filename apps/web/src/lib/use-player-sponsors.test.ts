import { describe, expect, it } from "vitest";
import {
  buildPlayerSponsors,
  type PlayerSponsorSummary,
} from "./use-player-sponsors.js";

// buildPlayerSponsors is pure - the hook only feeds it the live query
// data - so the indexing semantics test directly.

const sponsor = (
  overrides: Partial<PlayerSponsorSummary>,
): PlayerSponsorSummary =>
  ({
    id: "s1",
    slug: "alex-young",
    player_name: "Alex Young",
    sponsor_name: "Acme Ltd",
    sponsor_email: "acme@example.com",
    sponsor_website: null,
    sponsor_phone: null,
    sponsor_logo_url: null,
    sponsor_message: null,
    amount_pence: 5000,
    season: 2026,
    approved: true,
    paid_at: "2026-01-01",
    created_at: "2026-01-01",
    display_name: null,
    notes: null,
    stripe_payment_intent_id: null,
    ...overrides,
  });

describe("buildPlayerSponsors", () => {
  it("returns an empty map while the query has no data", () => {
    expect(buildPlayerSponsors(undefined).size).toBe(0);
  });

  it("indexes sponsors by person slug", () => {
    const map = buildPlayerSponsors({ sponsors: [sponsor({})] });
    expect(map.get("alex-young")?.sponsor_name).toBe("Acme Ltd");
  });

  it("drops rows without a slug - they can't match a person card", () => {
    const map = buildPlayerSponsors({
      sponsors: [sponsor({ id: "s2", slug: null })],
    });
    expect(map.size).toBe(0);
  });
});
