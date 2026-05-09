import { describe, expect, it } from "vitest";
import {
  buildPlayerNameMap,
  chooseDisplayName,
  filterPeople,
  fuzzyScore,
  rankPlayCricketSuggestions,
  summarisePersonStats,
  type PersonRow,
  type PlayCricketPlayer,
} from "./record-linking-tab.lib";

function makePerson(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "1",
    name: "Jane Doe",
    playCricketId: null,
    type: "member",
    ...overrides,
  };
}

describe("fuzzyScore", () => {
  it("returns 0 when either string is empty", () => {
    expect(fuzzyScore("", "alex")).toBe(0);
    expect(fuzzyScore("alex", "")).toBe(0);
    expect(fuzzyScore("", "")).toBe(0);
    expect(fuzzyScore("   ", "alex")).toBe(0);
  });

  it("returns 1 for an exact match (case-insensitive)", () => {
    expect(fuzzyScore("Alex Young", "alex young")).toBe(1);
    expect(fuzzyScore("  alex  ", "alex")).toBe(1);
  });

  it("returns 0.8 when the query is a substring of the target", () => {
    expect(fuzzyScore("alex", "alex young")).toBe(0.8);
  });

  it("returns 0.7 when the target is a substring of the query", () => {
    expect(fuzzyScore("alex young (junior)", "alex young")).toBe(0.7);
  });

  it("returns a token-overlap score (≤0.6) for partial matches", () => {
    const score = fuzzyScore("Alex Smith", "Alexander Jones");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(0.6);
  });

  it("returns 0 when there is no token overlap", () => {
    expect(fuzzyScore("Bob", "Charlie")).toBe(0);
  });

  it("uses the better of forward and reverse token ratios", () => {
    // single query token matches one of three target tokens
    const score = fuzzyScore("alex", "alex bob smith");
    // substring rule fires first → 0.8
    expect(score).toBe(0.8);
  });
});

describe("chooseDisplayName", () => {
  it("returns the name when it is set", () => {
    expect(chooseDisplayName(makePerson({ name: "Alex" }))).toBe("Alex");
  });

  it("trims whitespace and falls back when blank", () => {
    expect(chooseDisplayName(makePerson({ name: "   " }))).toBe(
      "(unnamed member)",
    );
  });

  it("uses the dependent placeholder for juniors", () => {
    expect(
      chooseDisplayName(makePerson({ name: null, type: "dependent" })),
    ).toBe("(unnamed junior)");
  });
});

describe("summarisePersonStats", () => {
  it("returns zeroes for an empty list", () => {
    expect(summarisePersonStats([])).toEqual({
      totalMembers: 0,
      totalDependents: 0,
      linkedPcMembers: 0,
      linkedPcDeps: 0,
      unlinkedPcMembers: 0,
      unlinkedPcDeps: 0,
    });
  });

  it("counts members vs dependents and linked vs unlinked", () => {
    const people: PersonRow[] = [
      makePerson({ id: "1", playCricketId: "10", type: "member" }),
      makePerson({ id: "2", playCricketId: null, type: "member" }),
      makePerson({ id: "3", playCricketId: "20", type: "dependent" }),
      makePerson({ id: "4", playCricketId: null, type: "dependent" }),
      makePerson({ id: "5", playCricketId: null, type: "dependent" }),
    ];
    expect(summarisePersonStats(people)).toEqual({
      totalMembers: 2,
      totalDependents: 3,
      linkedPcMembers: 1,
      linkedPcDeps: 1,
      unlinkedPcMembers: 1,
      unlinkedPcDeps: 2,
    });
  });
});

describe("filterPeople", () => {
  const people: PersonRow[] = [
    makePerson({ id: "1", name: "Alice", playCricketId: "10" }),
    makePerson({ id: "2", name: "Bob", playCricketId: null }),
    makePerson({
      id: "3",
      name: "Charlie",
      type: "dependent",
      parentName: "Alice",
      playCricketId: null,
    }),
  ];

  it("returns everything with default filters (linked + unlinked, all types)", () => {
    const result = filterPeople(people, {
      search: "",
      showLinked: true,
      showUnlinked: true,
      personTypeFilter: "all",
    });
    expect(result).toHaveLength(3);
  });

  it("hides linked when showLinked=false", () => {
    const result = filterPeople(people, {
      search: "",
      showLinked: false,
      showUnlinked: true,
      personTypeFilter: "all",
    });
    expect(result.map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("hides unlinked when showUnlinked=false", () => {
    const result = filterPeople(people, {
      search: "",
      showLinked: true,
      showUnlinked: false,
      personTypeFilter: "all",
    });
    expect(result.map((p) => p.id)).toEqual(["1"]);
  });

  it("filters by personTypeFilter", () => {
    const members = filterPeople(people, {
      search: "",
      showLinked: true,
      showUnlinked: true,
      personTypeFilter: "member",
    });
    expect(members.map((p) => p.id)).toEqual(["1", "2"]);

    const deps = filterPeople(people, {
      search: "",
      showLinked: true,
      showUnlinked: true,
      personTypeFilter: "dependent",
    });
    expect(deps.map((p) => p.id)).toEqual(["3"]);
  });

  it("matches the search term against name and parentName", () => {
    const byName = filterPeople(people, {
      search: "ali",
      showLinked: true,
      showUnlinked: true,
      personTypeFilter: "all",
    });
    // "Alice" (id 1) matches by name; "Charlie" (id 3) matches by parentName
    expect(byName.map((p) => p.id).sort()).toEqual(["1", "3"]);
  });

  it("ignores leading/trailing whitespace in the search", () => {
    const result = filterPeople(people, {
      search: "  bob  ",
      showLinked: true,
      showUnlinked: true,
      personTypeFilter: "all",
    });
    expect(result.map((p) => p.id)).toEqual(["2"]);
  });
});

describe("rankPlayCricketSuggestions", () => {
  const players: PlayCricketPlayer[] = [
    { memberId: 1, name: "Alex Young" },
    { memberId: 2, name: "Bob Smith" },
    { memberId: 3, name: "Alex Smith" },
    { memberId: 4, name: "Charlie Brown" },
  ];

  it("returns top suggestions by name when search is empty (uses person name)", () => {
    const result = rankPlayCricketSuggestions(players, "Alex Young", "");
    expect(result[0]?.memberId).toBe(1);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to substring matching when a search term is provided", () => {
    const result = rankPlayCricketSuggestions(players, "Alex Young", "smith");
    expect(result.map((p) => p.memberId).sort()).toEqual([2, 3]);
  });

  it("matches by member id substring when typing digits", () => {
    const result = rankPlayCricketSuggestions(players, "Alex Young", "4");
    expect(result.map((p) => p.memberId)).toContain(4);
  });

  it("returns an empty array when nothing scores above the threshold", () => {
    const result = rankPlayCricketSuggestions(players, "Zzzz Qqqqq", "");
    expect(result).toEqual([]);
  });

  it("caps the result list at 20", () => {
    const many: PlayCricketPlayer[] = Array.from({ length: 30 }, (_, i) => ({
      memberId: i + 1,
      name: "Alex Young",
    }));
    expect(rankPlayCricketSuggestions(many, "Alex Young", "")).toHaveLength(20);
  });
});

describe("buildPlayerNameMap", () => {
  it("returns an empty map when input is null", () => {
    expect(buildPlayerNameMap(null).size).toBe(0);
  });

  it("maps stringified memberId to name", () => {
    const map = buildPlayerNameMap([
      { memberId: 1, name: "A" },
      { memberId: 22, name: "B" },
    ]);
    expect(map.get("1")).toBe("A");
    expect(map.get("22")).toBe("B");
    expect(map.get("99")).toBeUndefined();
  });
});
