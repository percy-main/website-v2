import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import { eventMetadataSchema, type EventMetadata } from "./index.ts";
import {
  expandEventOccurrences,
  latestOccurrenceBefore,
  nextOccurrence,
  occurrenceOnDate,
  recurrenceSummary,
  viewedOccurrence,
} from "./recurrence.ts";

const londonTime = (iso: string) =>
  formatInTimeZone(new Date(iso), "Europe/London", "HH:mm");

describe("expandEventOccurrences - non-recurring", () => {
  const event: EventMetadata = {
    when: "2024-06-01T18:00:00+01:00",
    finish: "2024-06-01T20:00:00+01:00",
  };

  it("returns the single date when in range", () => {
    const got = expandEventOccurrences(event, {
      from: new Date("2024-05-01T00:00:00Z"),
      to: new Date("2024-07-01T00:00:00Z"),
    });
    expect(got).toEqual([
      {
        start: "2024-06-01T18:00:00+01:00",
        finish: "2024-06-01T20:00:00+01:00",
        date: "2024-06-01",
      },
    ]);
  });

  it("returns nothing when out of range", () => {
    const got = expandEventOccurrences(event, {
      from: new Date("2024-07-01T00:00:00Z"),
      to: new Date("2024-08-01T00:00:00Z"),
    });
    expect(got).toEqual([]);
  });
});

describe("expandEventOccurrences - weekly across the BST->GMT boundary", () => {
  // UK clocks go back on 2024-10-27. 18:00 London must hold on both sides.
  const event: EventMetadata = {
    when: "2024-10-22T18:00:00+01:00", // Tuesday, BST
    finish: "2024-10-22T19:30:00+01:00",
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU" },
  };

  it("keeps wall-clock 18:00 across the switch", () => {
    const got = expandEventOccurrences(event, {
      from: new Date("2024-10-20T00:00:00Z"),
      to: new Date("2024-11-06T00:00:00Z"),
    });
    expect(got.map((o) => o.date)).toEqual([
      "2024-10-22",
      "2024-10-29",
      "2024-11-05",
    ]);
    for (const o of got) expect(londonTime(o.start)).toBe("18:00");
    // The GMT-side instant is a real UTC hour later than the BST-side one.
    expect(got[0]?.start).toBe("2024-10-22T17:00:00.000Z");
    expect(got[1]?.start).toBe("2024-10-29T18:00:00.000Z");
    // Duration is preserved.
    expect(got[1]?.finish).toBe("2024-10-29T19:30:00.000Z");
  });
});

describe("expandEventOccurrences - monthly nth weekday", () => {
  it("expands the 2nd Tuesday of each month", () => {
    const event: EventMetadata = {
      when: "2024-01-09T19:00:00+00:00", // 2nd Tuesday of Jan 2024
      recurrence: { rrule: "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2" },
    };
    const got = expandEventOccurrences(event, {
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-04-01T00:00:00Z"),
    });
    expect(got.map((o) => o.date)).toEqual([
      "2024-01-09",
      "2024-02-13",
      "2024-03-12",
    ]);
  });
});

describe("expandEventOccurrences - termination", () => {
  it("stops after COUNT occurrences", () => {
    const event: EventMetadata = {
      when: "2024-01-02T18:00:00+00:00",
      recurrence: { rrule: "FREQ=WEEKLY;COUNT=3" },
    };
    const got = expandEventOccurrences(event, {
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-12-31T00:00:00Z"),
    });
    expect(got.map((o) => o.date)).toEqual([
      "2024-01-02",
      "2024-01-09",
      "2024-01-16",
    ]);
  });

  it("stops at UNTIL", () => {
    const event: EventMetadata = {
      when: "2024-01-02T18:00:00+00:00",
      recurrence: { rrule: "FREQ=WEEKLY;UNTIL=20240116T235959Z" },
    };
    const got = expandEventOccurrences(event, {
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-12-31T00:00:00Z"),
    });
    expect(got.map((o) => o.date)).toEqual([
      "2024-01-02",
      "2024-01-09",
      "2024-01-16",
    ]);
  });
});

describe("expandEventOccurrences - exceptions", () => {
  it("skips cancelled dates", () => {
    const event: EventMetadata = {
      when: "2024-10-22T18:00:00+01:00",
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        exceptions: ["2024-10-29"],
      },
    };
    const got = expandEventOccurrences(event, {
      from: new Date("2024-10-20T00:00:00Z"),
      to: new Date("2024-11-06T00:00:00Z"),
    });
    expect(got.map((o) => o.date)).toEqual(["2024-10-22", "2024-11-05"]);
  });
});

describe("nextOccurrence / occurrenceOnDate / latestOccurrenceBefore", () => {
  const event: EventMetadata = {
    when: "2024-01-02T18:00:00+00:00",
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU" },
  };

  it("finds the next occurrence after a given instant", () => {
    const next = nextOccurrence(event, new Date("2024-01-10T00:00:00Z"));
    expect(next?.date).toBe("2024-01-16");
  });

  it("finds the occurrence on a specific London date", () => {
    expect(occurrenceOnDate(event, "2024-01-16")?.date).toBe("2024-01-16");
    expect(occurrenceOnDate(event, "2024-01-17")).toBeUndefined();
  });

  it("finds the most recent past occurrence", () => {
    const prev = latestOccurrenceBefore(
      event,
      new Date("2024-01-17T00:00:00Z"),
    );
    expect(prev?.date).toBe("2024-01-16");
  });
});

describe("viewedOccurrence", () => {
  const event: EventMetadata = {
    when: "2024-01-02T18:00:00+00:00",
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=4" }, // last is 2024-01-23
  };

  it("uses the ?on date when valid", () => {
    expect(
      viewedOccurrence(event, { on: "2024-01-16", now: new Date("2024-01-01") })
        ?.date,
    ).toBe("2024-01-16");
  });

  it("falls back to the next upcoming occurrence", () => {
    expect(
      viewedOccurrence(event, {
        on: null,
        now: new Date("2024-01-10T00:00:00Z"),
      })?.date,
    ).toBe("2024-01-16");
  });

  it("falls back to the most recent past occurrence once the series is over", () => {
    expect(
      viewedOccurrence(event, { on: null, now: new Date("2024-06-01") })?.date,
    ).toBe("2024-01-23");
  });
});

describe("eventMetadataSchema - recurrence validation", () => {
  it.each([
    "2024-01-02T18:00+00:00",
    "2024-01-02T18:00:00+00:00",
    "2024-01-02T18:00:00.123+00:00",
  ])("accepts supported ISO timestamp precision: %s", (when) => {
    expect(eventMetadataSchema.safeParse({ when }).success).toBe(true);
  });

  it.each([
    "2024-02-30T18:00+00:00",
    "2024-01-02T25:00:00+00:00",
    "2024-01-02T18:00",
  ])("rejects invalid or offset-free timestamp: %s", (when) => {
    expect(eventMetadataSchema.safeParse({ when }).success).toBe(false);
  });

  it("accepts a valid recurrence", () => {
    const result = eventMetadataSchema.safeParse({
      when: "2024-01-02T18:00:00+00:00",
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU", exceptions: ["2024-01-09"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unparseable rrule", () => {
    const result = eventMetadataSchema.safeParse({
      when: "2024-01-02T18:00:00+00:00",
      recurrence: { rrule: "this is not a rule" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed exception date", () => {
    const result = eventMetadataSchema.safeParse({
      when: "2024-01-02T18:00:00+00:00",
      recurrence: { rrule: "FREQ=WEEKLY", exceptions: ["09/01/2024"] },
    });
    expect(result.success).toBe(false);
  });
});

describe("recurrenceSummary", () => {
  it("returns human text for a recurring event", () => {
    expect(
      recurrenceSummary({
        when: "2024-01-02T18:00:00+00:00",
        recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU" },
      }),
    ).toBe("every week on Tuesday");
  });

  it("returns undefined for a non-recurring event", () => {
    expect(
      recurrenceSummary({ when: "2024-01-02T18:00:00+00:00" }),
    ).toBeUndefined();
  });
});
