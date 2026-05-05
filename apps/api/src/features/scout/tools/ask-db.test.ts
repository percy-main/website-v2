import { describe, expect, it } from "vitest";
import { looksLikePlanningProse } from "./ask-db.ts";

describe("looksLikePlanningProse", () => {
  it.each([
    "Let me check the schema first.",
    "Now let me search in matchday and match_result:",
    "I'll start with the season filter.",
    "Perfect. Now let me search:",
    "OK, next I'll join the player table",
    "Got it. First, I need to confirm the names.",
  ])("flags planning text: %s", (text) => {
    expect(looksLikePlanningProse(text)).toBe(true);
  });

  it.each([
    "Filtered to 1st XI league matches in 2025.",
    "No 2026 rows for this query; latest season available is 2025.",
    "Used the pre-aggregated bowling average rather than recomputing.",
    "",
  ])("does not flag genuine summaries / empty: %s", (text) => {
    expect(looksLikePlanningProse(text)).toBe(false);
  });

  it("flags any text ending in a colon (the model trailed off mid-sentence)", () => {
    expect(looksLikePlanningProse("Searching for the 2026 fixture:")).toBe(
      true,
    );
  });
});
