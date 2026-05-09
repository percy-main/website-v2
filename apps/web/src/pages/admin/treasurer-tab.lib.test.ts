import { describe, expect, it } from "vitest";
import { daysOverdue } from "./treasurer-tab.lib";

describe("daysOverdue", () => {
  it("returns 0 for a charge dated 'now'", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    expect(daysOverdue("2026-05-09T12:00:00Z", now)).toBe(0);
  });

  it("returns 1 for a charge from 24 hours ago", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    expect(daysOverdue("2026-05-08T12:00:00Z", now)).toBe(1);
  });

  it("returns the floor of a partial-day difference", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    // 23 hours earlier — still 0 days
    expect(daysOverdue("2026-05-08T13:00:00Z", now)).toBe(0);
  });

  it("returns 30 for a charge from a month ago", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    expect(daysOverdue("2026-04-09T12:00:00Z", now)).toBe(30);
  });

  it("returns negative for future-dated charges", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    expect(daysOverdue("2026-05-10T12:00:00Z", now)).toBe(-1);
  });
});
