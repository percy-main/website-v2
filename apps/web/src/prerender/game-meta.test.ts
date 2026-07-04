import type { paths } from "@/lib/api.gen.js";
import { describe, expect, it } from "vitest";
import {
  gameHeadData,
  gameHeadMetadataSchema,
  monthHeadData,
} from "./game-meta.js";

type GameData =
  paths["/api/games/{matchId}"]["get"]["responses"]["200"]["content"]["application/json"];

// `when` fixtures carry an explicit offset so parsing is deterministic
// across machine timezones (real payloads are naive London-local strings;
// the prerender Lambda pins TZ=Europe/London to match UK browsers).

function game(overrides: Partial<GameData> = {}): GameData {
  return {
    id: "123456",
    matchDate: "12/07/2026",
    matchTime: "13:00",
    home: true,
    team: { id: "T1", name: "1st XI" },
    opposition: {
      club: { id: "C9", name: "Tynemouth CC" },
      team: { id: "T9", name: "2nd XI" },
    },
    league: { id: "L1", name: "NTCL" },
    competition: { id: "CMP", name: "Division 1", type: "League" },
    groundName: "St Johns Terrace",
    when: "2026-07-12T13:00:00+01:00",
    outcome: null,
    scoreDescription: null,
    sponsorName: null,
    sponsorLogoUrl: null,
    location: { name: "Percy Main Cricket and Sports Club" },
    result: null,
    sponsor: null,
    lineup: null,
    availabilityRequest: null,
    ...overrides,
  };
}

describe("gameHeadData", () => {
  it("titles a home fixture with venue marker and date", () => {
    const head = gameHeadData(game());
    expect(head.title).toBe("1st XI vs Tynemouth CC 2nd XI (H) - 12 July 2026");
  });

  it("describes a fixture with kickoff time and sponsor", () => {
    const head = gameHeadData(
      game({
        sponsor: {
          name: "Acme Scaffolding",
          logoUrl: null,
          message: null,
          website: null,
          phone: null,
        },
      }),
    );
    expect(head.description).toContain("1st XI play Tynemouth CC 2nd XI");
    expect(head.description).toContain("at home");
    expect(head.description).toContain("1:00pm on Sunday 12 July 2026");
    expect(head.description).toContain("Match sponsored by Acme Scaffolding.");
  });

  it("describes a result with outcome and score", () => {
    const head = gameHeadData(
      game({ outcome: "W", scoreDescription: "142/6 - 138" }),
    );
    expect(head.description).toContain("Won (142/6 - 138)");
    expect(head.description).toContain("against Tynemouth CC 2nd XI");
    expect(head.description).toContain("Full scorecard");
  });

  it("swaps home and away teams for away games", () => {
    const homeMeta = gameHeadData(game()).metadata;
    expect(homeMeta.homeTeam).toBe("Percy Main 1st XI");
    expect(homeMeta.awayTeam).toBe("Tynemouth CC 2nd XI");

    const awayMeta = gameHeadData(game({ home: false })).metadata;
    expect(awayMeta.homeTeam).toBe("Tynemouth CC 2nd XI");
    expect(awayMeta.awayTeam).toBe("Percy Main 1st XI");
  });

  it("produces metadata that round-trips through its schema", () => {
    const head = gameHeadData(game());
    const parsed = gameHeadMetadataSchema.safeParse(head.metadata);
    expect(parsed.success).toBe(true);
  });

  it("copes with a dateless game (no when)", () => {
    const head = gameHeadData(game({ when: null, location: null }));
    expect(head.title).toBe("1st XI vs Tynemouth CC 2nd XI (H)");
    expect(head.metadata.when).toBeNull();
    // Falls back to the ground name from the summary.
    expect(head.metadata.locationName).toBe("St Johns Terrace");
  });
});

describe("monthHeadData", () => {
  it("capitalizes the month and includes the year", () => {
    const head = monthHeadData(2026, "july");
    expect(head.title).toBe("Fixtures & Events - July 2026");
    expect(head.description).toContain("July 2026");
  });
});
