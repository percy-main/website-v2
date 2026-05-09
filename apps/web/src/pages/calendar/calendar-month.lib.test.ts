import { describe, expect, it } from "vitest";
import {
  categoriseTeam,
  filterItemsByCategory,
  findDividerIndex,
  groupItemsByDate,
  groupItemsByDay,
  parseMonthYear,
  sortCalendarItems,
  summariseMonth,
} from "./calendar-month.lib";

describe("categoriseTeam", () => {
  it("recognises 1st XI", () => {
    expect(categoriseTeam("Percy Main 1st XI")).toBe("1xi");
  });

  it("recognises 2nd XI", () => {
    expect(categoriseTeam("Percy Main 2nd XI")).toBe("2xi");
  });

  it("recognises Midweek XI (case-insensitive)", () => {
    expect(categoriseTeam("Midweek XI")).toBe("mid");
    expect(categoriseTeam("midweek")).toBe("mid");
  });

  it("recognises juniors via 'under', 'junior', 'colts', and U-codes", () => {
    expect(categoriseTeam("Under 13s")).toBe("jun");
    expect(categoriseTeam("Junior Dynamos")).toBe("jun");
    expect(categoriseTeam("Colts")).toBe("jun");
    expect(categoriseTeam("U13 boys")).toBe("jun");
  });

  it("falls back to '1xi' for unknown teams", () => {
    expect(categoriseTeam("Touring XI")).toBe("1xi");
    expect(categoriseTeam("")).toBe("1xi");
  });
});

describe("parseMonthYear", () => {
  it("parses valid year + month", () => {
    expect(parseMonthYear("2026", "may")).toEqual({
      year: 2026,
      monthIndex: 4,
    });
  });

  it("parses month name case-insensitively", () => {
    expect(parseMonthYear("2026", "May")).toEqual({
      year: 2026,
      monthIndex: 4,
    });
    expect(parseMonthYear("2026", "MAY")).toEqual({
      year: 2026,
      monthIndex: 4,
    });
  });

  it("returns null for non-numeric year", () => {
    expect(parseMonthYear("twenty", "may")).toBeNull();
  });

  it("returns null for unknown month name", () => {
    expect(parseMonthYear("2026", "smarch")).toBeNull();
  });

  it("returns null for empty inputs", () => {
    expect(parseMonthYear("", "may")).toBeNull();
    expect(parseMonthYear("2026", "")).toBeNull();
  });
});

describe("sortCalendarItems", () => {
  it("sorts by ascending datetime", () => {
    const out = sortCalendarItems([
      { id: "b", when: "2026-05-10T14:00:00Z", type: "game" as const },
      { id: "a", when: "2026-05-09T14:00:00Z", type: "game" as const },
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("places games before events on the same datetime", () => {
    const out = sortCalendarItems([
      { id: "evt", when: "2026-05-10T14:00:00Z", type: "event" as const },
      { id: "gm", when: "2026-05-10T14:00:00Z", type: "game" as const },
    ]);
    expect(out.map((i) => i.id)).toEqual(["gm", "evt"]);
  });

  it("does not mutate the input", () => {
    const input = [
      { id: "b", when: "2026-05-10T14:00:00Z", type: "game" as const },
      { id: "a", when: "2026-05-09T14:00:00Z", type: "game" as const },
    ];
    sortCalendarItems(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("filterItemsByCategory", () => {
  const items = [
    { id: "1", when: "2026-05-10", type: "game" as const, category: "1xi" },
    { id: "2", when: "2026-05-11", type: "game" as const, category: "2xi" },
    { id: "3", when: "2026-05-12", type: "event" as const, category: "event" },
  ];

  it("returns input verbatim for 'all'", () => {
    expect(filterItemsByCategory(items, "all")).toEqual(items);
  });

  it("filters to a single category", () => {
    expect(filterItemsByCategory(items, "1xi").map((i) => i.id)).toEqual(["1"]);
    expect(filterItemsByCategory(items, "event").map((i) => i.id)).toEqual([
      "3",
    ]);
  });
});

describe("groupItemsByDate", () => {
  it("groups items by YYYY-MM-DD and sorts chronologically", () => {
    const out = groupItemsByDate([
      { id: "b", when: "2026-05-11T14:00:00Z", type: "game" as const },
      { id: "a", when: "2026-05-10T14:00:00Z", type: "game" as const },
      { id: "a2", when: "2026-05-10T18:00:00Z", type: "game" as const },
    ]);
    expect(out.map((g) => g.dateStr)).toEqual(["2026-05-10", "2026-05-11"]);
    expect(out[0].items.map((i) => i.id)).toEqual(["a", "a2"]);
  });

  it("returns empty list for no items", () => {
    expect(groupItemsByDate([])).toEqual([]);
  });
});

describe("groupItemsByDay", () => {
  it("groups by day-of-month", () => {
    const map = groupItemsByDay([
      { id: "x", when: "2026-05-10T14:00:00", type: "game" as const },
      { id: "y", when: "2026-05-10T18:00:00", type: "game" as const },
      { id: "z", when: "2026-05-12T18:00:00", type: "game" as const },
    ]);
    expect(map.get(10)?.length).toBe(2);
    expect(map.get(12)?.length).toBe(1);
    expect(map.get(11)).toBeUndefined();
  });
});

describe("summariseMonth", () => {
  const now = new Date("2026-05-09T00:00:00Z");

  it("counts wins, losses, and upcoming games", () => {
    expect(
      summariseMonth(
        [
          { when: "2026-05-01", type: "game", outcome: "W" },
          { when: "2026-05-02", type: "game", outcome: "L" },
          { when: "2026-05-03", type: "game", outcome: "D" },
          { when: "2026-05-10", type: "game" },
          { when: "2026-05-11", type: "event" },
          { when: "2026-05-08", type: "game" },
        ],
        now,
      ),
    ).toEqual({ won: 1, lost: 1, upcoming: 1 });
  });

  it("ignores events", () => {
    expect(
      summariseMonth([{ when: "2026-05-10", type: "event" }], now),
    ).toEqual({ won: 0, lost: 0, upcoming: 0 });
  });

  it("returns zeros for empty input", () => {
    expect(summariseMonth([], now)).toEqual({ won: 0, lost: 0, upcoming: 0 });
  });
});

describe("findDividerIndex", () => {
  const today = new Date("2026-05-09T12:00:00Z");

  it("returns the index of the last past day", () => {
    const grouped = [
      { dateStr: "2026-05-01" },
      { dateStr: "2026-05-05" },
      { dateStr: "2026-05-15" },
    ];
    expect(findDividerIndex(grouped, today)).toBe(1);
  });

  it("returns -1 when nothing is past", () => {
    const grouped = [{ dateStr: "2026-05-15" }, { dateStr: "2026-05-20" }];
    expect(findDividerIndex(grouped, today)).toBe(-1);
  });

  it("returns -1 when the only past content is at the end (no trailing divider)", () => {
    const grouped = [{ dateStr: "2026-04-30" }, { dateStr: "2026-05-01" }];
    expect(findDividerIndex(grouped, today)).toBe(-1);
  });

  it("returns -1 for empty input", () => {
    expect(findDividerIndex([], today)).toBe(-1);
  });
});
