import { describe, expect, it } from "vitest";
// Helpers from the member.slug backfill migration. The migration itself is
// immutable and self-contained, so its only non-trivial logic - turning a
// name into a unique slug - is exported and tested here. Unique slugs matter
// for safety: member.slug doubles as the profile link, so a duplicate would
// point two members at one profile.
import {
  nextFreeSlug,
  slugify,
} from "./migrations/2026-06-24T09:00:00.000Z.ts";

describe("slugify", () => {
  it("lowercases and hyphenates names", () => {
    expect(slugify("Alex Young")).toBe("alex-young");
  });

  it("strips accents via NFKD decomposition", () => {
    expect(slugify("José Núñez")).toBe("jose-nunez");
  });

  it("collapses punctuation and trims leading/trailing hyphens", () => {
    expect(slugify("  O'Brien-Smith (Jr.) ")).toBe("o-brien-smith-jr");
  });

  it("returns an empty string for a name with no slug characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("nextFreeSlug", () => {
  it("returns the base when it is free", () => {
    expect(nextFreeSlug("alex-young", new Set())).toBe("alex-young");
  });

  it("suffixes -2 on the first collision", () => {
    expect(nextFreeSlug("john-smith", new Set(["john-smith"]))).toBe(
      "john-smith-2",
    );
  });

  it("skips taken suffixes to the next free number", () => {
    const used = new Set(["john-smith", "john-smith-2", "john-smith-3"]);
    expect(nextFreeSlug("john-smith", used)).toBe("john-smith-4");
  });

  it("treats an existing person-page slug as taken (never reuses it)", () => {
    // A person content_item slug is seeded into `used`, so a same-named member
    // gets a distinct slug rather than being linked to that page.
    expect(nextFreeSlug("jane-doe", new Set(["jane-doe"]))).toBe("jane-doe-2");
  });

  it("does not mutate the provided set", () => {
    const used = new Set(["john-smith"]);
    nextFreeSlug("john-smith", used);
    expect(used.has("john-smith-2")).toBe(false);
  });
});
