import { describe, expect, it, vi } from "vitest";

// use-people transitively imports the people corpus (.mdx files), which
// only exists inside a Vite build - stub the loader; mergePeople takes
// the static list as a parameter so the stub never matters here.
vi.mock("@/lib/people.js", () => ({
  getAllPeople: () => [],
  getPersonBySlug: () => undefined,
}));

import { mergePeople } from "./use-people.js";

// mergePeople is pure - the hook only feeds it getAllPeople() + the live
// query data - so the transition-fallback semantics test directly.

const staticAlex = {
  slug: "alex-young",
  name: "Alex Young (static)",
  photo: "/images/contentful/abc/photo.jpeg",
  isDBSChecked: true,
  hasLeftClub: false,
};
const staticBryan = {
  slug: "bryan-cowey",
  name: "Bryan Cowey",
  isDBSChecked: false,
  hasLeftClub: true,
};

const apiAlex = {
  slug: "alex-young",
  title: "Alex Young",
  metadata: { isDBSChecked: true, hasLeftClub: false },
};

describe("mergePeople", () => {
  it("renders the static corpus while the query has no data", () => {
    const map = mergePeople([staticAlex, staticBryan], undefined);
    expect(map.size).toBe(2);
    expect(map.get("alex-young")?.name).toBe("Alex Young (static)");
    expect(map.get("bryan-cowey")?.hasLeftClub).toBe(true);
  });

  it("the API wins per slug; unmigrated static people fill the gaps", () => {
    const map = mergePeople([staticAlex, staticBryan], {
      items: [apiAlex],
      removed: [],
    });
    expect(map.get("alex-young")?.name).toBe("Alex Young");
    expect(map.get("bryan-cowey")?.name).toBe("Bryan Cowey");
  });

  it("a tombstoned slug is dropped from the static corpus", () => {
    const map = mergePeople([staticAlex, staticBryan], {
      items: [],
      removed: ["alex-young"],
    });
    expect(map.has("alex-young")).toBe(false);
    expect(map.has("bryan-cowey")).toBe(true);
  });

  it("never resurrects a tombstone, even if the server sent the slug in items too", () => {
    const map = mergePeople([staticAlex], {
      items: [apiAlex],
      removed: ["alex-young"],
    });
    expect(map.has("alex-young")).toBe(false);
  });

  it("keeps the static entry when an API row's metadata fails its schema", () => {
    const map = mergePeople([staticAlex], {
      items: [
        {
          slug: "alex-young",
          title: "Broken",
          metadata: { isDBSChecked: "yes" },
        },
      ],
      removed: [],
    });
    expect(map.get("alex-young")?.name).toBe("Alex Young (static)");
  });

  it("carries the API photo descriptor through as the picture", () => {
    const photo = {
      sources: { webp: "/uploads/content/x/320.webp 320w" },
      img: { src: "/uploads/content/x/640.jpg", w: 640, h: 480 },
    };
    const map = mergePeople([], {
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
