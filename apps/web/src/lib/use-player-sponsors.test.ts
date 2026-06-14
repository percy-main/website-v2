import { describe, expect, it } from "vitest";
import {
  buildPlayerSponsors,
  type PlayerSponsorSummary,
} from "./use-player-sponsors.js";

// buildPlayerSponsors is pure - the hook only feeds it the live query
// data - so the indexing semantics test directly.

const sponsor = (
  overrides: Partial<PlayerSponsorSummary>,
): PlayerSponsorSummary => ({
  slug: "alex-young",
  sponsor_name: "Acme Ltd",
  sponsor_website: null,
  sponsor_phone: null,
  sponsor_logo_url: null,
  sponsor_message: null,
  display_name: null,
  ...overrides,
});

describe("buildPlayerSponsors", () => {
  it("returns an empty map while the query has no data", () => {
    expect(buildPlayerSponsors(undefined).size).toBe(0);
  });

  it("indexes sponsors by person slug", () => {
    const map = buildPlayerSponsors([sponsor({})]);
    expect(map.get("alex-young")?.sponsor_name).toBe("Acme Ltd");
  });

  it("drops rows without a slug - they can't match a person card", () => {
    const map = buildPlayerSponsors([sponsor({ slug: null })]);
    expect(map.size).toBe(0);
  });
});
