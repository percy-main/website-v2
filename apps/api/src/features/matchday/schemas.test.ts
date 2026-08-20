import { describe, expect, it } from "vitest";
import { createMatchdaySchema, teamNewsImageQuerySchema } from "./schemas.ts";

const base = {
  teamId: "team-1",
  matchDate: "2026-09-01",
  opposition: "Rival CC",
};

describe("createMatchdaySchema matchTime", () => {
  it.each(["00:00", "09:30", "23:59"])("accepts %s", (matchTime) => {
    expect(createMatchdaySchema.safeParse({ ...base, matchTime }).success).toBe(
      true,
    );
  });

  // The PWA form's <input type="time"> can't produce these, but the
  // endpoint is callable directly - out-of-range values must not
  // persist onto the team sheet.
  it.each(["24:00", "29:99", "12:60", "9:30", "12:5", "noon"])(
    "rejects %s",
    (matchTime) => {
      expect(
        createMatchdaySchema.safeParse({ ...base, matchTime }).success,
      ).toBe(false);
    },
  );

  it("accepts an omitted matchTime", () => {
    expect(createMatchdaySchema.safeParse(base).success).toBe(true);
  });
});

describe("teamNewsImageQuerySchema isHome", () => {
  it("parses 'true' and 'false' to booleans", () => {
    expect(teamNewsImageQuerySchema.parse({ isHome: "true" }).isHome).toBe(
      true,
    );
    expect(teamNewsImageQuerySchema.parse({ isHome: "false" }).isHome).toBe(
      false,
    );
  });

  it("leaves isHome undefined when absent", () => {
    expect(teamNewsImageQuerySchema.parse({}).isHome).toBeUndefined();
  });

  it("rejects values that used to coerce silently to away", () => {
    expect(teamNewsImageQuerySchema.safeParse({ isHome: "yes" }).success).toBe(
      false,
    );
    expect(teamNewsImageQuerySchema.safeParse({ isHome: "1" }).success).toBe(
      false,
    );
  });
});
