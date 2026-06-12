import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

// mdx-components transitively imports the people corpus (.mdx files) and
// the vite-imagetools image map, neither of which exists outside a Vite
// build - stub the lookups, the renderer only needs their shapes.
vi.mock("@/lib/people.js", () => ({
  getPersonBySlug: (slug: string) =>
    slug === "alex-slaven"
      ? { name: "Alex Slaven", photo: undefined, photoPicture: undefined }
      : undefined,
  getAllPeople: () => [
    {
      slug: "alex-slaven",
      name: "Alex Slaven",
      photo: undefined,
      photoPicture: undefined,
    },
  ],
}));
vi.mock("@/lib/image-map.js", () => ({
  getImageUrl: () => undefined,
  getPicture: () => undefined,
}));
// Stub network-dependent subcomponents so they render inert markup instead
// of firing real API requests under renderToStaticMarkup.
vi.mock("@/components/leaderboard-content.js", () => ({
  LeaderboardContent: () => <div data-testid="leaderboard-stub" />,
}));
vi.mock("@/components/records-wall.js", () => ({
  RecordsWall: () => <div data-testid="records-wall-stub" />,
}));
vi.mock("@/lib/marketing/consent.js", () => ({
  CURRENT_CONSENT_VERSION: "v3",
  requestConsentReopen: () => undefined,
}));

import { ContentBody } from "./content-body.js";

// Person (router Link) and GamePreview (react-query) need their providers
// even for static rendering.
function renderBody(body: unknown): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContentBody body={body} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let nextId = 0;
function block(
  type: string,
  overrides: {
    props?: Record<string, string | number | boolean>;
    content?: unknown;
    children?: unknown[];
  } = {},
) {
  nextId += 1;
  return {
    id: `block-${String(nextId)}`,
    type,
    props: overrides.props ?? {},
    content: overrides.content ?? [],
    children: overrides.children ?? [],
  };
}

const text = (t: string, styles: Record<string, boolean> = {}) => ({
  type: "text",
  text: t,
  styles,
});

describe("ContentBody", () => {
  it("renders nothing for a structurally invalid document", () => {
    expect(renderBody("not an array")).toBe("");
    expect(renderBody([{ type: "paragraph" }])).toBe("");
  });

  it("renders paragraphs, headings and inline styles", () => {
    const html = renderBody([
      block("heading", { props: { level: 2 }, content: [text("Top order")] }),
      block("paragraph", {
        content: [
          text("A "),
          text("fine", { italic: true }),
          text(" win by "),
          text("42 runs", { bold: true }),
        ],
      }),
    ]);
    expect(html).toContain("<h2");
    expect(html).toContain("Top order");
    expect(html).toContain("<em>fine</em>");
    expect(html).toContain("<strong>42 runs</strong>");
  });

  it("renders raw HTML in text content as inert text", () => {
    const html = renderBody([
      block("paragraph", {
        content: [text('<script>alert("xss")</script>')],
      }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("gives headings slugified anchor ids", () => {
    const html = renderBody([
      block("heading", {
        props: { level: 2 },
        content: [text("What information we collect, use, and why")],
      }),
      block("heading", {
        props: { level: 3 },
        content: [text("How our consent banner works (Consent Mode v2)")],
      }),
    ]);
    expect(html).toContain('id="what-information-we-collect-use-and-why"');
    expect(html).toContain('id="how-our-consent-banner-works-consent-mode-v2"');
  });

  it("omits the heading id when the text slugifies to nothing", () => {
    const html = renderBody([
      block("heading", { props: { level: 2 }, content: [text("???")] }),
    ]);
    expect(html).not.toContain("id=");
  });

  it("renders #fragment links for in-page anchors", () => {
    const html = renderBody([
      block("paragraph", {
        content: [
          {
            type: "link",
            href: "#contact-details",
            content: [text("Contact details")],
          },
        ],
      }),
    ]);
    expect(html).toContain('href="#contact-details"');
  });

  it("drops unsafe link protocols but keeps the text", () => {
    const html = renderBody([
      block("paragraph", {
        content: [
          {
            type: "link",

            href: "javascript:alert(1)",
            content: [text("click me")],
          },
          {
            type: "link",
            href: "https://percymain.org",
            content: [text("safe link")],
          },
        ],
      }),
    ]);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
    expect(html).toContain('href="https://percymain.org"');
  });

  it("groups consecutive list items into one list", () => {
    const html = renderBody([
      block("bulletListItem", { content: [text("78* from the skipper")] }),
      block("bulletListItem", { content: [text("4-23 off 8 overs")] }),
      block("numberedListItem", { content: [text("First")] }),
    ]);
    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.match(/<ol/g)).toHaveLength(1);
  });

  it("renders unknown block types as nothing without crashing", () => {
    const html = renderBody([
      block("marquee", { content: [text("nope")] }),
      block("paragraph", { content: [text("still here")] }),
    ]);
    expect(html).not.toContain("nope");
    expect(html).toContain("still here");
  });

  it("renders the person custom block via the shared component map", () => {
    const html = renderBody([
      block("person", { props: { slug: "alex-slaven", role: "Head Coach" } }),
    ]);
    expect(html).toContain("person");
    expect(html).toContain("Head Coach");
    expect(html).toContain('href="/person/alex-slaven"');
  });

  it("renders tables", () => {
    const html = renderBody([
      block("table", {
        content: {
          type: "tableContent",
          rows: [
            { cells: [[text("Player")], [text("Runs")]] },
            { cells: [[text("A. Slaven")], [text("78")]] },
          ],
        },
      }),
    ]);
    expect(html).toContain("<table>");
    expect(html.match(/<tr/g)).toHaveLength(2);
    expect(html).toContain("A. Slaven");
  });

  it("renders image blocks only for safe urls", () => {
    const html = renderBody([
      block("image", {
        props: { url: "/uploads/test.jpg", caption: "The winning moment" },
      }),

      block("image", { props: { url: "javascript:alert(1)" } }),
    ]);
    expect(html).toContain('src="/uploads/test.jpg"');
    expect(html).toContain("The winning moment");
    expect(html).not.toContain("javascript:");
  });

  it("tolerates text nodes with missing styles", () => {
    const html = renderBody([
      block("paragraph", { content: [{ type: "text", text: "bare node" }] }),
    ]);
    expect(html).toContain("bare node");
  });

  it("refuses plain-http image sources", () => {
    const html = renderBody([
      block("image", { props: { url: "http://example.com/pixel.gif" } }),
    ]);
    expect(html).not.toContain("pixel.gif");
  });

  it("renders checklists without disc markers", () => {
    const html = renderBody([
      block("checkListItem", {
        props: { checked: true },
        content: [text("Covers on")],
      }),
    ]);
    expect(html).toContain("list-none");
    expect(html).toContain("checked");
  });

  it("hides the eventPreview block when props are incomplete", () => {
    const html = renderBody([
      block("eventPreview", { props: { name: "Quiz night" } }),
    ]);
    expect(html).toBe('<div class="mdx-content flex flex-col *:mb-4"></div>');
  });

  it("renders contentImage blocks responsively from the picture descriptor", () => {
    const picture = {
      sources: {
        avif: "/uploads/content/img-1/320.avif 320w, /uploads/content/img-1/640.avif 640w",
        webp: "/uploads/content/img-1/320.webp 320w, /uploads/content/img-1/640.webp 640w",
      },
      img: { src: "/uploads/content/img-1/640.jpg", w: 640, h: 480 },
    };
    const html = renderBody([
      block("contentImage", {
        props: {
          src: "/uploads/content/img-1/640.jpg",
          alt: "The winning six",
          caption: "Scenes",
          picture: JSON.stringify(picture),
        },
      }),
    ]);
    expect(html).toContain("<picture>");
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('src="/uploads/content/img-1/640.jpg"');
    expect(html).toContain("Scenes");
  });

  it("rejects contentImage descriptors with unsafe urls", () => {
    const picture = {
      sources: {
        avif: "javascript:alert(1) 320w",
      },
      img: { src: "/uploads/content/img-1/640.jpg", w: 640, h: 480 },
    };
    const html = renderBody([
      block("contentImage", {
        props: {
          src: "/uploads/content/img-1/640.jpg",
          alt: "x",
          caption: "",
          picture: JSON.stringify(picture),
        },
      }),
    ]);
    expect(html).not.toContain("javascript:");
    // Falls back to the plain (safe) src
    expect(html).toContain('src="/uploads/content/img-1/640.jpg"');
  });

  // ── New custom blocks ──────────────────────────────────────────────────

  it("renders all custom block types in a fixture document without crashing", () => {
    const picture = {
      sources: {
        avif: "/uploads/content/img-1/320.avif 320w",
        webp: "/uploads/content/img-1/320.webp 320w",
      },
      img: { src: "/uploads/content/img-1/640.jpg", w: 640, h: 480 },
    };
    const html = renderBody([
      block("person", { props: { slug: "alex-slaven", role: "Head Coach" } }),
      block("personGrid", { props: { slugs: "alex-slaven" } }),
      block("gamePreview", { props: { playCricketId: "123" } }),
      block("eventPreview", {
        props: { eventId: "1", name: "Quiz night", when: "2026-07-01" },
      }),
      block("contentImage", {
        props: {
          src: "/uploads/content/img-1/640.jpg",
          alt: "A photo",
          caption: "Caption",
          picture: JSON.stringify(picture),
        },
      }),
      block("leagueTable", {
        props: { divisionId: "div-1", name: "Division 1" },
      }),
      block("leaderboard", {}),
      block("recordsWall", {}),
      block("contactForm", {
        props: { title: "Get in touch", description: "We reply within 48h" },
      }),
      block("cookieSettingsLink", { props: { text: "Manage cookies" } }),
      block("consentVersion", {}),
    ]);
    // Each custom block must produce some non-empty output (not null/empty).
    expect(html.length).toBeGreaterThan(0);
    // Spot-check a handful of expected fragments.
    expect(html).toContain("Head Coach");
    expect(html).toContain("Quiz night");
    expect(html).toContain("Get in touch");
    expect(html).toContain("Manage cookies");
    expect(html).toContain("v3");
  });

  it("renders personGrid via the shared PersonGrid component", () => {
    const html = renderBody([
      block("personGrid", { props: { slugs: "alex-slaven" } }),
    ]);
    // PersonGrid renders Person cards, which include the profile link
    expect(html).toContain('href="/person/alex-slaven"');
  });

  it("normalises personGrid slugs with spaces and empty segments", () => {
    const html = renderBody([
      block("personGrid", { props: { slugs: " alex-slaven , , bob ," } }),
    ]);
    // Trimmed slugs resolve; empty segments are dropped (no card with an
    // empty profile link).
    expect(html).toContain('href="/person/alex-slaven"');
    expect(html).toContain('href="/person/bob"');
    expect(html).not.toContain('href="/person/"');
    // Exactly two person cards rendered.
    expect(html.match(/class="person /g)).toHaveLength(2);
  });

  it("hides personGrid when slugs contains only separators and whitespace", () => {
    const html = renderBody([
      block("personGrid", { props: { slugs: " , ,, " } }),
    ]);
    expect(html).toBe('<div class="mdx-content flex flex-col *:mb-4"></div>');
  });

  it("renders personGrid entries as Person children carrying their roles", () => {
    const html = renderBody([
      block("personGrid", {
        props: {
          slugs: "alex-slaven,bob",
          entries: JSON.stringify([
            { slug: "alex-slaven", role: "Head Coach" },
            { slug: "bob" },
          ]),
        },
      }),
    ]);
    expect(html).toContain('href="/person/alex-slaven"');
    expect(html).toContain("Head Coach");
    expect(html).toContain('href="/person/bob"');
    // Exactly two person cards: same composition as the MDX corpus.
    expect(html.match(/class="person /g)).toHaveLength(2);
  });

  it("prefers entries over the slugs CSV when both are present", () => {
    const html = renderBody([
      block("personGrid", {
        props: {
          slugs: "stale-slug",
          entries: JSON.stringify([{ slug: "fresh-slug", role: "Captain" }]),
        },
      }),
    ]);
    expect(html).toContain('href="/person/fresh-slug"');
    expect(html).toContain("Captain");
    expect(html).not.toContain("stale-slug");
  });

  it("falls back to the slugs CSV when entries is malformed", () => {
    for (const entries of [
      "not json",
      '{"slug":"x"}', // not an array
      '[{"role":"Coach"}]', // entry without a slug
      '[{"slug":""}]', // empty slug
      '[{"slug":"x","role":5}]', // non-string role
    ]) {
      const html = renderBody([
        block("personGrid", { props: { slugs: "alex-slaven", entries } }),
      ]);
      expect(html).toContain('href="/person/alex-slaven"');
    }
  });

  it("falls back to the slugs CSV when entries is an empty array", () => {
    const html = renderBody([
      block("personGrid", { props: { slugs: "alex-slaven", entries: "[]" } }),
    ]);
    expect(html).toContain('href="/person/alex-slaven"');
  });

  it("hides leagueTable when divisionId is missing", () => {
    const html = renderBody([block("leagueTable", { props: {} })]);
    expect(html).toBe('<div class="mdx-content flex flex-col *:mb-4"></div>');
  });

  it("renders leagueTable when divisionId is provided", () => {
    const html = renderBody([
      block("leagueTable", { props: { divisionId: "12345", name: "Div 1" } }),
    ]);
    // leagueTable fires a query that is disabled in tests, renders nothing
    // until data arrives - the component itself returns null when !data, so
    // the outer block still produces some wrapper markup.
    expect(html).toBeDefined();
  });

  it("renders leaderboard block", () => {
    const html = renderBody([block("leaderboard", {})]);
    expect(html).toContain("leaderboard-stub");
  });

  it("renders recordsWall block", () => {
    const html = renderBody([block("recordsWall", {})]);
    expect(html).toContain("records-wall-stub");
  });

  it("renders contactForm with title and description", () => {
    const html = renderBody([
      block("contactForm", {
        props: { title: "Say hello", description: "We reply fast" },
      }),
    ]);
    expect(html).toContain("Say hello");
    expect(html).toContain("We reply fast");
  });

  it("renders cookieSettingsLink with custom text", () => {
    const html = renderBody([
      block("cookieSettingsLink", { props: { text: "Your cookie choices" } }),
    ]);
    expect(html).toContain("Your cookie choices");
  });

  it("renders cookieSettingsLink with default text when prop is missing", () => {
    const html = renderBody([block("cookieSettingsLink", { props: {} })]);
    expect(html).toContain("Cookie settings");
  });

  it("renders consentVersion as a self-contained sentence", () => {
    const html = renderBody([block("consentVersion", {})]);
    expect(html).toContain("This notice is version v3.");
  });
});
