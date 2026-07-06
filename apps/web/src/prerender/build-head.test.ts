import { describe, expect, it } from "vitest";
import { buildHead, type HeadInput } from "./build-head.js";

const ORIGIN = "https://www.percymain.org";

function input(overrides: Partial<HeadInput> = {}): HeadInput {
  return {
    kind: "page",
    url: "/club/history",
    title: "Club History",
    description: "How it all started.",
    metadata: {},
    ...overrides,
  };
}

describe("buildHead", () => {
  it("emits title, description, canonical and OG basics", () => {
    const head = buildHead(input());
    expect(head).toContain(
      "<title>Club History | Percy Main Community Sports Club</title>",
    );
    expect(head).toContain(
      '<meta name="description" content="How it all started." />',
    );
    expect(head).toContain(
      `<link rel="canonical" href="${ORIGIN}/club/history" />`,
    );
    expect(head).toContain(
      '<meta property="og:title" content="Club History" />',
    );
    expect(head).toContain(
      `<meta property="og:url" content="${ORIGIN}/club/history" />`,
    );
    expect(head).toContain('<meta property="og:type" content="website" />');
    expect(head).toContain(
      `<meta property="og:image" content="${ORIGIN}/images/og-default.png" />`,
    );
    expect(head).toContain('<meta name="twitter:card" content="summary" />');
  });

  it("falls back to the site description when the item has none", () => {
    const head = buildHead(input({ description: null }));
    expect(head).toContain('content="Percy Main Community Sports Club');
  });

  it("escapes HTML in titles and descriptions", () => {
    const head = buildHead(
      input({ title: 'A "great" <club>', description: "Fish & chips" }),
    );
    expect(head).toContain("A &quot;great&quot; &lt;club&gt;");
    expect(head).toContain("Fish &amp; chips");
    expect(head).not.toContain("<club>");
  });

  it("passes page metadata.ldjson through as JSON-LD", () => {
    const head = buildHead(
      input({
        metadata: {
          ldjson: { "@type": "SportsClub", name: "Percy Main" },
        },
      }),
    );
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).toContain('"@type":"SportsClub"');
  });

  it("emits no JSON-LD for a page without ldjson", () => {
    expect(buildHead(input())).not.toContain("application/ld+json");
  });

  it("escapes </script> content inside JSON-LD", () => {
    const head = buildHead(
      input({ metadata: { ldjson: { name: "</script><script>alert(1)" } } }),
    );
    expect(head).not.toContain("</script><script>alert(1)");
    expect(head).toContain("\\u003c/script");
  });

  describe("news", () => {
    const news = input({
      kind: "news",
      url: "/news/article/season-opener",
      title: "Season Opener",
      publishedAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-02T09:00:00.000Z",
    });

    it("emits article OG type, timestamps and NewsArticle JSON-LD", () => {
      const head = buildHead(news);
      expect(head).toContain('<meta property="og:type" content="article" />');
      expect(head).toContain(
        '<meta property="article:published_time" content="2026-04-01T10:00:00.000Z" />',
      );
      expect(head).toContain(
        '<meta property="article:modified_time" content="2026-04-02T09:00:00.000Z" />',
      );
      expect(head).toContain('"@type":"NewsArticle"');
      expect(head).toContain('"headline":"Season Opener"');
      expect(head).toContain('"datePublished":"2026-04-01T10:00:00.000Z"');
    });

    it("uses the first contentImage block as the lead OG image", () => {
      const head = buildHead({
        ...news,
        body: [
          { id: "1", type: "paragraph", props: {}, children: [] },
          {
            id: "2",
            type: "contentImage",
            props: {
              src: "/uploads/content/abc/original.webp",
              picture: JSON.stringify({
                sources: {},
                img: { src: "/uploads/content/abc/1280.webp", w: 1280, h: 720 },
              }),
            },
            children: [],
          },
        ],
      });
      expect(head).toContain(
        `<meta property="og:image" content="${ORIGIN}/uploads/content/abc/1280.webp" />`,
      );
      expect(head).toContain(
        '<meta name="twitter:card" content="summary_large_image" />',
      );
    });

    it("uses the first photoGallery photo as the lead OG image", () => {
      const head = buildHead({
        ...news,
        body: [
          { id: "1", type: "paragraph", props: {}, children: [] },
          {
            id: "2",
            type: "photoGallery",
            props: {
              images: JSON.stringify([
                {
                  picture: {
                    sources: {},
                    img: {
                      src: "/uploads/content/g1/1280.webp",
                      w: 1280,
                      h: 853,
                    },
                  },
                },
                {
                  picture: {
                    sources: {},
                    img: {
                      src: "/uploads/content/g2/1280.webp",
                      w: 1280,
                      h: 853,
                    },
                  },
                },
              ]),
            },
            children: [],
          },
        ],
      });
      expect(head).toContain(
        `<meta property="og:image" content="${ORIGIN}/uploads/content/g1/1280.webp" />`,
      );
    });

    it("falls back to plain src when the picture descriptor is malformed", () => {
      const head = buildHead({
        ...news,
        body: [
          {
            id: "1",
            type: "contentImage",
            props: {
              src: "/uploads/content/abc/original.webp",
              picture: "{oops",
            },
            children: [],
          },
        ],
      });
      expect(head).toContain(
        `content="${ORIGIN}/uploads/content/abc/original.webp"`,
      );
    });
  });

  describe("event", () => {
    it("emits Event JSON-LD with schedule and venue", () => {
      const head = buildHead(
        input({
          kind: "event",
          url: "/calendar/event/quiz-night",
          title: "Quiz Night",
          metadata: {
            when: "2026-08-01T19:00:00+01:00",
            finish: "2026-08-01T22:00:00+01:00",
            location: {
              name: "The Clubhouse",
              street: "St John's Terrace",
              city: "North Shields",
              postcode: "NE29 6HS",
            },
          },
        }),
      );
      expect(head).toContain('"@type":"Event"');
      expect(head).toContain('"startDate":"2026-08-01T19:00:00+01:00"');
      expect(head).toContain('"endDate":"2026-08-01T22:00:00+01:00"');
      expect(head).toContain('"addressLocality":"North Shields"');
    });

    it("emits no JSON-LD when event metadata does not parse", () => {
      const head = buildHead(
        input({ kind: "event", url: "/calendar/event/x", metadata: {} }),
      );
      expect(head).not.toContain("application/ld+json");
    });
  });

  describe("person", () => {
    it("uses the profile photo for OG image and Person JSON-LD", () => {
      const head = buildHead(
        input({
          kind: "person",
          url: "/person/jane-smith",
          title: "Jane Smith",
          metadata: {
            isDBSChecked: true,
            hasLeftClub: false,
            photo: {
              sources: {},
              img: { src: "/uploads/content/p/1280.webp", w: 1280, h: 1280 },
            },
          },
        }),
      );
      expect(head).toContain('<meta property="og:type" content="profile" />');
      expect(head).toContain(
        `<meta property="og:image" content="${ORIGIN}/uploads/content/p/1280.webp" />`,
      );
      expect(head).toContain('"@type":"Person"');
      expect(head).toContain('"name":"Jane Smith"');
    });

    it("falls back to the default OG image without a photo", () => {
      const head = buildHead(
        input({
          kind: "person",
          url: "/person/jane-smith",
          title: "Jane Smith",
          metadata: { isDBSChecked: false, hasLeftClub: false },
        }),
      );
      expect(head).toContain(
        `<meta property="og:image" content="${ORIGIN}/images/og-default.png" />`,
      );
    });
  });

  describe("game", () => {
    const OG_PNG = "https://api.v2.percymain.org/api/og/game/123456";

    function gameInput(overrides: Partial<HeadInput> = {}): HeadInput {
      return input({
        kind: "game",
        url: "/calendar/game/123456",
        title: "1st XI vs Tynemouth CC 2nd XI (H) - 12 July 2026",
        description: "Won (142/6 - 138) - full scorecard.",
        metadata: {
          when: "2026-07-12T13:00:00",
          homeTeam: "Percy Main 1st XI",
          awayTeam: "Tynemouth CC 2nd XI",
          locationName: "Percy Main Cricket and Sports Club",
        },
        ogImageUrl: OG_PNG,
        ...overrides,
      });
    }

    it("uses the explicit scorecard PNG as OG image with a large card", () => {
      const head = buildHead(gameInput());
      expect(head).toContain(
        `<meta property="og:image" content="${OG_PNG}" />`,
      );
      expect(head).toContain(
        '<meta name="twitter:card" content="summary_large_image" />',
      );
      expect(head).toContain('<meta property="og:type" content="website" />');
      expect(head).toContain(
        `<link rel="canonical" href="${ORIGIN}/calendar/game/123456" />`,
      );
    });

    it("emits SportsEvent JSON-LD with both teams and the venue", () => {
      const head = buildHead(gameInput());
      expect(head).toContain('"@type":"SportsEvent"');
      expect(head).toContain('"startDate":"2026-07-12T13:00:00"');
      expect(head).toContain(
        '"homeTeam":{"@type":"SportsTeam","name":"Percy Main 1st XI"}',
      );
      expect(head).toContain(
        '"awayTeam":{"@type":"SportsTeam","name":"Tynemouth CC 2nd XI"}',
      );
      expect(head).toContain(
        '"location":{"@type":"Place","name":"Percy Main Cricket and Sports Club"}',
      );
    });

    it("emits no JSON-LD when game metadata does not parse", () => {
      const head = buildHead(gameInput({ metadata: {} }));
      expect(head).not.toContain("ld+json");
    });
  });

  describe("calendar-month", () => {
    it("uses the default OG image and emits no JSON-LD", () => {
      const head = buildHead(
        input({
          kind: "calendar-month",
          url: "/calendar/2026/july",
          title: "Fixtures & Events - July 2026",
          description: "Fixtures, results and events for July 2026.",
        }),
      );
      expect(head).toContain(
        `<meta property="og:image" content="${ORIGIN}/images/og-default.png" />`,
      );
      expect(head).toContain('<meta name="twitter:card" content="summary" />');
      expect(head).toContain('<meta property="og:type" content="website" />');
      expect(head).not.toContain("ld+json");
    });
  });
});
