import { describe, expect, it } from "vitest";
import { buildPeople } from "./use-people.js";

// buildPeople is pure - the hook only feeds it the live query data - so
// the projection semantics test directly.

const apiAlex = {
  slug: "alex-young",
  title: "Alex Young",
  metadata: { isDBSChecked: true, hasLeftClub: false },
};

describe("buildPeople", () => {
  it("returns an empty roster while the query has no data", () => {
    expect(buildPeople(undefined).size).toBe(0);
  });

  it("projects API items into summaries keyed by slug", () => {
    const map = buildPeople({ items: [apiAlex], removed: [] });
    expect(map.size).toBe(1);
    expect(map.get("alex-young")).toMatchObject({
      name: "Alex Young",
      isDBSChecked: true,
      hasLeftClub: false,
    });
  });

  it("never renders a tombstone, even if the server sent the slug in items too", () => {
    const map = buildPeople({ items: [apiAlex], removed: ["alex-young"] });
    expect(map.has("alex-young")).toBe(false);
  });

  it("drops an API row whose metadata fails its schema", () => {
    const map = buildPeople({
      items: [
        {
          slug: "alex-young",
          title: "Broken",
          metadata: { isDBSChecked: "yes" },
        },
      ],
      removed: [],
    });
    expect(map.has("alex-young")).toBe(false);
  });

  it("carries the API photo descriptor through as the picture", () => {
    const photo = {
      sources: { webp: "/uploads/content/x/320.webp 320w" },
      img: { src: "/uploads/content/x/640.jpg", w: 640, h: 480 },
    };
    const map = buildPeople({
      items: [
        {
          slug: "new-signing",
          title: "New Signing",
          metadata: { isDBSChecked: false, hasLeftClub: false, photo },
        },
      ],
      removed: [],
    });
    expect(map.get("new-signing")?.picture).toEqual(photo);
  });
});
