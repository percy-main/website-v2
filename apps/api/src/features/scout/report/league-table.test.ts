import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "./evidence.ts";
import { extractLeagueTable } from "./run-report.ts";

const baseRecord = {
  id: "evi_x",
  sourceType: "play_cricket" as const,
  sourceRef: "ref",
  content: "stub",
  confidence: 5,
  permanence: "ephemeral" as const,
  retrievedAt: new Date().toISOString(),
};

describe("extractLeagueTable", () => {
  it("returns undefined for an empty evidence packet (cup match path)", () => {
    expect(extractLeagueTable([])).toBeUndefined();
  });

  it("returns undefined when no league_standings record is present", () => {
    const evidence: EvidenceRecord[] = [
      {
        ...baseRecord,
        claimType: "pc_match",
        content: "Some match",
      },
    ];
    expect(extractLeagueTable(evidence)).toBeUndefined();
  });

  it("returns undefined when league_standings has no structured table (researcher half-built it)", () => {
    const evidence: EvidenceRecord[] = [
      {
        ...baseRecord,
        claimType: "league_standings",
        content: "Standings exist but the structured field was omitted.",
      },
    ];
    expect(extractLeagueTable(evidence)).toBeUndefined();
  });

  it("extracts the structured table from the first league_standings record", () => {
    const evidence: EvidenceRecord[] = [
      {
        ...baseRecord,
        id: "evi_a",
        claimType: "pc_match",
        content: "Some match",
      },
      {
        ...baseRecord,
        id: "evi_b",
        claimType: "league_standings",
        content: "NTCL Div 4 N: Backworth top.",
        leagueTable: {
          name: "NTCL Division 4 North",
          columns: ["#", "Team", "P", "W", "L", "T", "Pts"],
          rows: [
            {
              values: ["1", "Backworth CC 1st XI", "8", "7", "1", "0", "96"],
              highlight: "opposition",
            },
            {
              values: ["3", "Percy Main CC 1st XI", "8", "4", "4", "0", "60"],
              highlight: "us",
            },
          ],
        },
      },
    ];

    const table = extractLeagueTable(evidence);

    expect(table).toBeDefined();
    expect(table?.name).toBe("NTCL Division 4 North");
    expect(table?.rows).toHaveLength(2);
    expect(table?.rows[0].highlight).toBe("opposition");
    expect(table?.rows[1].highlight).toBe("us");
  });

  it("returns the FIRST league_standings record when multiple are present (researcher should emit one but tolerate duplicates)", () => {
    const evidence: EvidenceRecord[] = [
      {
        ...baseRecord,
        id: "evi_first",
        claimType: "league_standings",
        content: "First snapshot",
        leagueTable: {
          name: "First",
          columns: ["#", "Team", "Pts"],
          rows: [{ values: ["1", "A", "10"] }],
        },
      },
      {
        ...baseRecord,
        id: "evi_second",
        claimType: "league_standings",
        content: "Second snapshot",
        leagueTable: {
          name: "Second",
          columns: ["#", "Team", "Pts"],
          rows: [{ values: ["1", "B", "20"] }],
        },
      },
    ];

    expect(extractLeagueTable(evidence)?.name).toBe("First");
  });
});
