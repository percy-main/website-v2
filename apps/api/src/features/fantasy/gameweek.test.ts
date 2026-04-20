import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentGameweek,
  getCurrentSeason,
  getPreviousSeason,
  isGameweekLocked,
  isPreSeason,
} from "./gameweek.ts";

describe("getCurrentSeason", () => {
  it("returns a 4-digit year string", () => {
    expect(getCurrentSeason()).toMatch(/^\d{4}$/);
  });
});

describe("getPreviousSeason", () => {
  it("returns one year less", () => {
    expect(getPreviousSeason("2026")).toBe("2025");
    expect(getPreviousSeason("2020")).toBe("2019");
  });
});

// ---------------------------------------------------------------------------
// getCurrentGameweek — UK timezone matters. The 2026 season's GW1 start date
// is Sat 2026-04-18 (per SEASON_GW1_DATES). UK is on BST (UTC+1) at that time
// of year. For boundary tests, UK midnight = 23:00 UTC the previous day.
// ---------------------------------------------------------------------------
describe("getCurrentGameweek (2026 season)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Pre-season ---
  it("returns 0 several days before GW1", () => {
    vi.setSystemTime(new Date("2026-04-13T12:00:00Z")); // Mon, pre-season
    expect(getCurrentGameweek("2026")).toBe(0);
  });

  it("returns 0 just before GW1 Saturday", () => {
    // Fri 2026-04-17 23:59 UK = 22:59 UTC (BST)
    vi.setSystemTime(new Date("2026-04-17T22:59:00Z"));
    expect(getCurrentGameweek("2026")).toBe(0);
  });

  // --- GW1 match weekend ---
  it("returns 1 at GW1 Saturday 00:00 UK", () => {
    // Sat 2026-04-18 00:00 UK = 2026-04-17T23:00Z
    vi.setSystemTime(new Date("2026-04-17T23:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(1);
  });

  it("returns 1 on GW1 Saturday midday", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(1);
  });

  it("returns 1 on GW1 Sunday", () => {
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(1);
  });

  it("returns 1 just before Monday rollover", () => {
    // Sun 2026-04-19 23:59 UK = 22:59Z
    vi.setSystemTime(new Date("2026-04-19T22:59:00Z"));
    expect(getCurrentGameweek("2026")).toBe(1);
  });

  // --- GW2 edit period ---
  it("returns 2 at Monday 00:00 UK (rollover)", () => {
    // Mon 2026-04-20 00:00 UK = 2026-04-19T23:00Z
    vi.setSystemTime(new Date("2026-04-19T23:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  it("returns 2 on Monday midday of GW2 edit period", () => {
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  it("returns 2 on Wednesday of GW2 edit period", () => {
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  it("returns 2 on Friday of GW2 edit period", () => {
    vi.setSystemTime(new Date("2026-04-24T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  // --- GW2 match weekend ---
  it("returns 2 on GW2 Saturday", () => {
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  it("returns 2 on GW2 Sunday", () => {
    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(2);
  });

  // --- GW3 rollover ---
  it("returns 3 on the Monday after GW2", () => {
    vi.setSystemTime(new Date("2026-04-27T12:00:00Z"));
    expect(getCurrentGameweek("2026")).toBe(3);
  });
});

describe("isPreSeason (2026 season)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is true before GW1", () => {
    vi.setSystemTime(new Date("2026-04-17T12:00:00Z"));
    expect(isPreSeason("2026")).toBe(true);
  });

  it("is false on GW1 Saturday", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(isPreSeason("2026")).toBe(false);
  });

  it("is false during GW2 edit period", () => {
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
    expect(isPreSeason("2026")).toBe(false);
  });
});

describe("isGameweekLocked (2026 season)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is false in pre-season", () => {
    vi.setSystemTime(new Date("2026-04-17T12:00:00Z")); // Fri, pre-season
    expect(isGameweekLocked("2026")).toBe(false);
  });

  it("is true on GW1 Saturday", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(isGameweekLocked("2026")).toBe(true);
  });

  it("is true on GW1 Sunday", () => {
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
    expect(isGameweekLocked("2026")).toBe(true);
  });

  it("is false on Monday (GW2 edit period)", () => {
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
    expect(isGameweekLocked("2026")).toBe(false);
  });

  it("is false on Friday (end of GW2 edit period)", () => {
    vi.setSystemTime(new Date("2026-04-24T12:00:00Z"));
    expect(isGameweekLocked("2026")).toBe(false);
  });

  it("is true on GW2 Saturday", () => {
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));
    expect(isGameweekLocked("2026")).toBe(true);
  });
});
