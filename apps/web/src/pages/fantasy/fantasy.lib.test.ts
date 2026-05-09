import { describe, expect, it } from "vitest";
import {
  calculateTeamPoints,
  formatSandwichCost,
  parseGameweekParam,
  parsePlayerIdParam,
  parseTeamIdParam,
  SLOT_ORDER,
  sortSquadBySlot,
} from "./fantasy.lib";

describe("SLOT_ORDER", () => {
  it("orders batting < bowling < allrounder", () => {
    expect(SLOT_ORDER.batting).toBeLessThan(SLOT_ORDER.bowling);
    expect(SLOT_ORDER.bowling).toBeLessThan(SLOT_ORDER.allrounder);
  });
});

describe("sortSquadBySlot", () => {
  it("sorts batting first, then bowling, then allrounder", () => {
    const out = sortSquadBySlot([
      { id: "a", slotType: "allrounder" },
      { id: "b", slotType: "bowling" },
      { id: "c", slotType: "batting" },
    ]);
    expect(out.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "a", slotType: "allrounder" },
      { id: "b", slotType: "batting" },
    ];
    sortSquadBySlot(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("places unknown slot types after all known slots", () => {
    const out = sortSquadBySlot([
      { id: "x", slotType: "wizard" },
      { id: "a", slotType: "allrounder" },
      { id: "b", slotType: "batting" },
    ]);
    expect(out[out.length - 1]?.id).toBe("x");
  });

  it("handles an empty squad", () => {
    expect(sortSquadBySlot([])).toEqual([]);
  });
});

describe("formatSandwichCost", () => {
  it("renders n sandwiches for cost n", () => {
    expect(formatSandwichCost(0)).toBe("");
    expect(formatSandwichCost(1)).toBe("🥪");
    expect(formatSandwichCost(3)).toBe("🥪🥪🥪");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatSandwichCost(null)).toBe("");
    expect(formatSandwichCost(undefined)).toBe("");
  });

  it("returns empty string for negative or non-finite values", () => {
    expect(formatSandwichCost(-2)).toBe("");
    expect(formatSandwichCost(Number.NaN)).toBe("");
    expect(formatSandwichCost(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("clamps very large values", () => {
    expect(formatSandwichCost(1000)).toBe("🥪".repeat(20));
  });
});

describe("parseGameweekParam", () => {
  it("returns undefined for missing/empty/null", () => {
    expect(parseGameweekParam(null)).toBeUndefined();
    expect(parseGameweekParam(undefined)).toBeUndefined();
    expect(parseGameweekParam("")).toBeUndefined();
  });

  it("parses a numeric string", () => {
    expect(parseGameweekParam("3")).toBe(3);
  });

  it("returns undefined for a non-numeric string", () => {
    expect(parseGameweekParam("abc")).toBeUndefined();
  });
});

describe("parseTeamIdParam", () => {
  it("returns null for missing/empty", () => {
    expect(parseTeamIdParam(null)).toBeNull();
    expect(parseTeamIdParam("")).toBeNull();
    expect(parseTeamIdParam(undefined)).toBeNull();
  });

  it("parses a numeric string", () => {
    expect(parseTeamIdParam("42")).toBe(42);
  });

  it("returns null for a non-numeric string", () => {
    expect(parseTeamIdParam("foo")).toBeNull();
  });
});

describe("parsePlayerIdParam", () => {
  it("returns null for missing/empty", () => {
    expect(parsePlayerIdParam(null)).toBeNull();
    expect(parsePlayerIdParam("")).toBeNull();
    expect(parsePlayerIdParam(undefined)).toBeNull();
  });

  it("returns the value verbatim when non-empty", () => {
    expect(parsePlayerIdParam("abc-123")).toBe("abc-123");
  });
});

describe("calculateTeamPoints", () => {
  it("sums points for non-captains", () => {
    expect(
      calculateTeamPoints([
        { isCaptain: false, seasonPoints: 10 },
        { isCaptain: false, seasonPoints: 20 },
      ]),
    ).toBe(30);
  });

  it("doubles the captain's points", () => {
    expect(
      calculateTeamPoints([
        { isCaptain: true, seasonPoints: 10 },
        { isCaptain: false, seasonPoints: 5 },
      ]),
    ).toBe(25);
  });

  it("returns 0 for empty squad", () => {
    expect(calculateTeamPoints([])).toBe(0);
  });
});
