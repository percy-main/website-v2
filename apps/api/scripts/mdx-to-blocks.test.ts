import {
  contentBodySchema,
  CUSTOM_BLOCK_TYPES,
  eventMetadataSchema,
} from "@percy-main/shared/content";
import { describe, expect, it, vi } from "vitest";
import {
  eventPublishedAt,
  findDuplicateLocationNames,
  imageIdForAsset,
  jsonEqual,
  mdxToBlocks,
  newsPublishedAt,
  parseEventSource,
  parseNewsSource,
  parsePageSource,
  resolveLocation,
  segmentMdx,
  type ResolveContentImage,
} from "./mdx-to-blocks.ts";

const STUB_PICTURE = {
  sources: { webp: "/uploads/content/abc/320.webp 320w" },
  img: { src: "/uploads/content/abc/320.jpg", w: 320, h: 240 },
};

/** Mirrors the prop mapping the migration script's resolver performs. */
const stubResolver: ResolveContentImage = ({ alt, caption }) =>
  Promise.resolve({
    src: STUB_PICTURE.img.src,
    alt: alt ?? "",
    caption: caption ?? "",
    picture: JSON.stringify(STUB_PICTURE),
  });

describe("segmentMdx", () => {
  it("splits markdown around a component", () => {
    const segments = segmentMdx(
      [
        "Intro paragraph.",
        "",
        '<GamePreview playCricketId="123" />',
        "",
        "Outro paragraph.",
      ].join("\n"),
    );
    expect(segments).toEqual([
      { kind: "markdown", text: "Intro paragraph." },
      {
        kind: "component",
        name: "GamePreview",
        attrs: { playCricketId: "123" },
      },
      { kind: "markdown", text: "Outro paragraph." },
    ]);
  });

  it("handles multiple adjacent components with no markdown between", () => {
    const segments = segmentMdx(
      [
        "#### Match Reports",
        "",
        '<GamePreview playCricketId="1" />',
        "",
        '<GamePreview playCricketId="2" />',
      ].join("\n"),
    );
    expect(segments.map((s) => s.kind)).toEqual([
      "markdown",
      "component",
      "component",
    ]);
  });

  it("parses multi-line attribute invocations", () => {
    const segments = segmentMdx(
      [
        "<Image",
        '  src="/images/contentful/abc/photo.jpeg"',
        '  alt="Jay\'s Leaving Do"',
        '  caption="Jay\'s Leaving Do"',
        "/>",
      ].join("\n"),
    );
    expect(segments).toEqual([
      {
        kind: "component",
        name: "Image",
        attrs: {
          src: "/images/contentful/abc/photo.jpeg",
          alt: "Jay's Leaving Do",
          caption: "Jay's Leaving Do",
        },
      },
    ]);
  });

  it("rejects unknown components", () => {
    expect(() => segmentMdx('<Twitter handle="pmcsc" />')).toThrow(
      /Unknown component <Twitter>/,
    );
  });

  it("rejects inline component invocations", () => {
    expect(() =>
      segmentMdx('See <GamePreview playCricketId="1" /> for details'),
    ).toThrow(/used inline/);
  });

  it("rejects JSX expression attributes", () => {
    expect(() => segmentMdx("<Image src={photo} />")).toThrow(
      /Unparseable component attributes/,
    );
  });

  it("rejects import and export statements", () => {
    expect(() => segmentMdx('import { X } from "./x.js"\n\nHello')).toThrow(
      /import\/export/,
    );
  });

  it("rejects unhandled HTML tags", () => {
    expect(() => segmentMdx("An <iframe src='x'></iframe> embed")).toThrow(
      /Unhandled JSX\/HTML construct/,
    );
  });

  it("flattens <sup> ordinal markers to plain text", () => {
    const segments = segmentMdx(
      "The away side, 9<sup>th</sup> in Division Three, lost.",
    );
    expect(segments).toEqual([
      { kind: "markdown", text: "The away side, 9th in Division Three, lost." },
    ]);
  });

  it("lifts a bare markdown image paragraph into an Image segment", () => {
    const segments = segmentMdx(
      [
        "##### Main Club Sponsor",
        "",
        "![The Crossling logo](/images/contentful/abc/logo.png)",
        "",
        "#### Weekly Schedule",
      ].join("\n"),
    );
    expect(segments).toEqual([
      { kind: "markdown", text: "##### Main Club Sponsor" },
      {
        kind: "component",
        name: "Image",
        attrs: {
          src: "/images/contentful/abc/logo.png",
          alt: "The Crossling logo",
        },
      },
      { kind: "markdown", text: "#### Weekly Schedule" },
    ]);
  });

  it("keeps an image inside a paragraph in the markdown segment", () => {
    // Adjacent non-blank lines = one paragraph; lifting the image would
    // split it, so it stays markdown (and markdownToBlocks rejects it).
    const segments = segmentMdx(
      ["Some text", "![alt](/images/x.png)", "more text"].join("\n"),
    );
    expect(segments).toEqual([
      {
        kind: "markdown",
        text: "Some text\n![alt](/images/x.png)\nmore text",
      },
    ]);
  });
});

describe("segmentMdx containers", () => {
  it("parses PersonGrid children with slug + role fidelity", () => {
    const segments = segmentMdx(
      [
        "### Captains",
        "",
        "<PersonGrid>",
        '  <Person slug="alex-young" role="1st XI Captain" />',
        '  <Person slug="john-allan" />',
        "</PersonGrid>",
      ].join("\n"),
    );
    expect(segments).toEqual([
      { kind: "markdown", text: "### Captains" },
      {
        kind: "personGrid",
        people: [
          { slug: "alex-young", role: "1st XI Captain" },
          { slug: "john-allan" },
        ],
      },
    ]);
  });

  it("rejects a PersonGrid containing a non-Person element", () => {
    expect(() =>
      segmentMdx(
        [
          "<PersonGrid>",
          '  <Person slug="a" />',
          '  <Image src="/images/x.png" />',
          "</PersonGrid>",
        ].join("\n"),
      ),
    ).toThrow(/may only contain <Person \/> children/);
  });

  it("rejects a PersonGrid containing loose text", () => {
    expect(() =>
      segmentMdx(
        [
          "<PersonGrid>",
          '  <Person slug="a" />',
          "  hello",
          "</PersonGrid>",
        ].join("\n"),
      ),
    ).toThrow(/non-component content/);
  });

  it("rejects an empty PersonGrid", () => {
    expect(() => segmentMdx("<PersonGrid>\n</PersonGrid>")).toThrow(
      /no <Person> children/,
    );
  });

  it("rejects a Person child without a slug", () => {
    expect(() =>
      segmentMdx('<PersonGrid>\n  <Person role="Coach" />\n</PersonGrid>'),
    ).toThrow(/without slug/);
  });

  it("rejects the self-closing PersonGrid attribute form (corpus never uses it)", () => {
    expect(() => segmentMdx('<PersonGrid slugs="a,b" />')).toThrow(
      /without <Person> children/,
    );
  });

  it("rejects an unclosed PersonGrid", () => {
    expect(() => segmentMdx('<PersonGrid>\n  <Person slug="a" />')).toThrow(
      /Unclosed <PersonGrid>/,
    );
  });

  it("rejects an inline PersonGrid", () => {
    expect(() =>
      segmentMdx('Meet <PersonGrid>\n<Person slug="a" />\n</PersonGrid>'),
    ).toThrow(/used inline/);
  });

  it("rejects a paired tag for a self-closing-only component", () => {
    expect(() => segmentMdx("<Leaderboard></Leaderboard>")).toThrow(
      /must be self-closing/,
    );
  });

  it("takes paired CookieSettingsLink text from its children", () => {
    const segments = segmentMdx(
      "<CookieSettingsLink>Manage cookies</CookieSettingsLink>",
    );
    expect(segments).toEqual([
      {
        kind: "component",
        name: "CookieSettingsLink",
        attrs: { text: "Manage cookies" },
      },
    ]);
  });

  it("rejects CookieSettingsLink with tag-shaped children", () => {
    expect(() =>
      segmentMdx("<CookieSettingsLink><b>hi</b></CookieSettingsLink>"),
    ).toThrow(/non-text children/);
  });
});

describe("mdxToBlocks", () => {
  it("maps <Image> to a contentImage block with the editor's prop set", async () => {
    const resolver = vi.fn(stubResolver);
    const blocks = await mdxToBlocks(
      [
        "<Image",
        '  src="/images/contentful/abc/photo.jpeg"',
        '  alt="The toss"',
        '  caption="Captains at the toss"',
        "/>",
      ].join("\n"),
      resolver,
    );

    expect(resolver).toHaveBeenCalledWith({
      src: "/images/contentful/abc/photo.jpeg",
      alt: "The toss",
      caption: "Captains at the toss",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "contentImage",
      props: {
        src: "/uploads/content/abc/320.jpg",
        alt: "The toss",
        caption: "Captains at the toss",
        picture: JSON.stringify(STUB_PICTURE),
      },
      children: [],
    });
    // content: "none" blocks carry no content array.
    expect(blocks[0]?.content).toBeUndefined();
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
  });

  it("maps <GamePreview> to a gamePreview block", async () => {
    const blocks = await mdxToBlocks(
      '<GamePreview playCricketId="6820338" />',
      stubResolver,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "gamePreview",
      props: { playCricketId: "6820338" },
      children: [],
    });
  });

  it("interleaves markdown blocks and component blocks in order", async () => {
    const blocks = await mdxToBlocks(
      [
        "Intro with a [link](https://percymain.org).",
        "",
        "#### Match Reports",
        "",
        '<GamePreview playCricketId="1" />',
        "",
        '<Image src="/images/contentful/abc/p.jpg" alt="a" caption="c" />',
        "",
        "**Bold** outro.",
      ].join("\n"),
      stubResolver,
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "heading",
      "gamePreview",
      "contentImage",
      "paragraph",
    ]);
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
  });

  it("fails on a GamePreview with no playCricketId", async () => {
    await expect(mdxToBlocks("<GamePreview />", stubResolver)).rejects.toThrow(
      /without playCricketId/,
    );
  });

  it("maps a bare markdown image through the contentImage pipeline", async () => {
    const resolver = vi.fn(stubResolver);
    const blocks = await mdxToBlocks(
      "![The Crossling logo](/images/contentful/abc/logo.png)",
      resolver,
    );
    expect(resolver).toHaveBeenCalledWith({
      src: "/images/contentful/abc/logo.png",
      alt: "The Crossling logo",
      caption: undefined,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "contentImage" });
  });

  it("still fails loudly on an image inside a paragraph", async () => {
    await expect(
      mdxToBlocks("An inline ![image](/images/x.png) here", stubResolver),
    ).rejects.toThrow(/Unsupported/);
  });

  it("still fails loudly on a linked image (the link would be dropped)", async () => {
    await expect(
      mdxToBlocks(
        "[![VX3 Logo](/images/contentful/abc/vx3.webp)](https://kit.percymain.org)",
        stubResolver,
      ),
    ).rejects.toThrow(/Unsupported/);
  });
});

describe("mdxToBlocks page components", () => {
  const single = async (body: string) => {
    const blocks = await mdxToBlocks(body, stubResolver);
    expect(blocks).toHaveLength(1);
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
    return blocks[0];
  };

  it("maps <Person> with the editor's prop set (role defaults empty)", async () => {
    expect(
      await single('<Person slug="paddy-rathbone" role="Welfare Officer" />'),
    ).toMatchObject({
      type: "person",
      props: { slug: "paddy-rathbone", role: "Welfare Officer" },
      children: [],
    });
    expect(await single('<Person slug="paddy-rathbone" />')).toMatchObject({
      type: "person",
      props: { slug: "paddy-rathbone", role: "" },
    });
  });

  it("fails on a Person with no slug", async () => {
    await expect(mdxToBlocks("<Person />", stubResolver)).rejects.toThrow(
      /<Person> without slug/,
    );
  });

  it("maps <EventPreview> id -> eventId (the block prop name)", async () => {
    expect(
      await single(
        [
          "<EventPreview",
          '  id="refugee-week-celebration"',
          '  name="Refugee Week Celebration"',
          '  when="2025-06-22T13:00+01:00"',
          "/>",
        ].join("\n"),
      ),
    ).toMatchObject({
      type: "eventPreview",
      props: {
        eventId: "refugee-week-celebration",
        name: "Refugee Week Celebration",
        when: "2025-06-22T13:00+01:00",
      },
    });
  });

  it("fails on an EventPreview missing a required prop", async () => {
    await expect(
      mdxToBlocks('<EventPreview id="x" name="y" />', stubResolver),
    ).rejects.toThrow(/<EventPreview> without when/);
  });

  it("maps <LeagueTable> (name defaults empty)", async () => {
    expect(
      await single(
        '<LeagueTable divisionId="135699" name="NTCL Division 4" />',
      ),
    ).toMatchObject({
      type: "leagueTable",
      props: { divisionId: "135699", name: "NTCL Division 4" },
    });
    expect(await single('<LeagueTable divisionId="135699" />')).toMatchObject({
      type: "leagueTable",
      props: { divisionId: "135699", name: "" },
    });
  });

  it("fails on a LeagueTable with no divisionId", async () => {
    await expect(mdxToBlocks("<LeagueTable />", stubResolver)).rejects.toThrow(
      /<LeagueTable> without divisionId/,
    );
  });

  it("maps the propless components to empty-prop blocks", async () => {
    expect(await single("<Leaderboard />")).toMatchObject({
      type: "leaderboard",
      props: {},
    });
    expect(await single("<RecordsWall />")).toMatchObject({
      type: "recordsWall",
      props: {},
    });
    expect(await single("<ConsentVersion />")).toMatchObject({
      type: "consentVersion",
      props: {},
    });
  });

  it("maps <ContactForm> with title/description defaulting empty", async () => {
    expect(
      await single(
        '<ContactForm title="Get in Touch" description="Drop us a message." />',
      ),
    ).toMatchObject({
      type: "contactForm",
      props: { title: "Get in Touch", description: "Drop us a message." },
    });
    expect(await single("<ContactForm />")).toMatchObject({
      type: "contactForm",
      props: { title: "", description: "" },
    });
  });

  it("maps <CookieSettingsLink>: children text when paired, default otherwise", async () => {
    expect(
      await single("<CookieSettingsLink>Manage cookies</CookieSettingsLink>"),
    ).toMatchObject({
      type: "cookieSettingsLink",
      props: { text: "Manage cookies" },
    });
    expect(await single("<CookieSettingsLink />")).toMatchObject({
      type: "cookieSettingsLink",
      props: { text: "Cookie settings" },
    });
  });

  it("maps <PersonGrid> children to role-preserving entries plus the slugs CSV", async () => {
    expect(
      await single(
        [
          "<PersonGrid>",
          '  <Person slug="alex-young" role="1st XI Captain" />',
          '  <Person slug="john-allan" />',
          "</PersonGrid>",
        ].join("\n"),
      ),
    ).toMatchObject({
      type: "personGrid",
      props: {
        slugs: "alex-young,john-allan",
        // Role kept on entries; the role-less child carries no role key
        // (NULL-for-unset, matching what the editor writes).
        entries: JSON.stringify([
          { slug: "alex-young", role: "1st XI Captain" },
          { slug: "john-allan" },
        ]),
      },
    });
  });

  it("converts a kitchen-sink page body to schema-valid, known block types", async () => {
    const blocks = await mdxToBlocks(
      [
        "Intro with a [link](/cricket).",
        "",
        "##### Captains",
        "",
        "<PersonGrid>",
        '  <Person slug="alex-young" role="Captain" />',
        "</PersonGrid>",
        "",
        '<Image src="/images/contentful/abc/p.jpg" alt="a" caption="c" />',
        "",
        '<LeagueTable divisionId="135699" name="Div 4" />',
        "",
        "<ContactForm />",
        "",
        "- one",
        "- two",
      ].join("\n"),
      stubResolver,
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "heading",
      "personGrid",
      "contentImage",
      "leagueTable",
      "contactForm",
      "bulletListItem",
      "bulletListItem",
    ]);
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
    const knownTypes = new Set<string>([
      "paragraph",
      "heading",
      "quote",
      "codeBlock",
      "table",
      "bulletListItem",
      "numberedListItem",
      ...Object.values(CUSTOM_BLOCK_TYPES),
    ]);
    for (const block of blocks) {
      expect(knownTypes.has(block.type)).toBe(true);
    }
  });
});

describe("parsePageSource", () => {
  it("parses full frontmatter including ldjson passthrough", () => {
    const parsed = parsePageSource(
      [
        "---",
        "title: Cricket",
        'description: "Percy Main Cricket Club."',
        "menuOrder: 2",
        "isMainMenu: true",
        "hideTitle: true",
        "ldjson:",
        '  "@type": SportsClub',
        "  name: Percy Main",
        "---",
        "",
        "Body text.",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      title: "Cricket",
      description: "Percy Main Cricket Club.",
      menuOrder: 2,
      isMainMenu: true,
      hideTitle: true,
      ldjson: { "@type": "SportsClub", name: "Percy Main" },
      body: "Body text.",
    });
  });

  it("applies the defaults (menuOrder 99, flags false, no ldjson)", () => {
    const parsed = parsePageSource(
      ["---", "title: Boxing", "---", "", "Body."].join("\n"),
    );
    expect(parsed).toEqual({
      title: "Boxing",
      menuOrder: 99,
      isMainMenu: false,
      hideTitle: false,
      body: "Body.",
    });
  });

  it("rejects a missing title", () => {
    expect(() =>
      parsePageSource(["---", "menuOrder: 1", "---", "Body."].join("\n")),
    ).toThrow();
  });

  it("rejects a non-object ldjson", () => {
    expect(() =>
      parsePageSource(
        ["---", "title: X", 'ldjson: "not an object"', "---", "Body."].join(
          "\n",
        ),
      ),
    ).toThrow();
  });

  it("rejects a non-integer menuOrder", () => {
    expect(() =>
      parsePageSource(
        ["---", "title: X", "menuOrder: 1.5", "---", "Body."].join("\n"),
      ),
    ).toThrow();
  });
});

describe("parseNewsSource", () => {
  const source = [
    "---",
    "title: 2nd XI Drought Comes To An End!",
    "date: 2025-05-13",
    "author: alex-young",
    "slug: 2nd-xi-drought-over",
    "tags:",
    "  - Cricket",
    "  - 2nd XI",
    "---",
    "",
    "Body text.",
  ].join("\n");

  it("parses full frontmatter", () => {
    const parsed = parseNewsSource(source);
    expect(parsed).toEqual({
      title: "2nd XI Drought Comes To An End!",
      date: "2025-05-13",
      author: "alex-young",
      slug: "2nd-xi-drought-over",
      tags: ["Cricket", "2nd XI"],
      body: "Body text.",
    });
  });

  it("defaults absent tags to an empty list", () => {
    const parsed = parseNewsSource(
      [
        "---",
        "title: Weekend Results",
        "date: 2025-05-05",
        "author: a",
        "slug: weekend-results",
        "---",
        "",
        "Body.",
      ].join("\n"),
    );
    expect(parsed.tags).toEqual([]);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      parseNewsSource(
        ["---", "date: 2025-05-05", "slug: x", "---", "Body."].join("\n"),
      ),
    ).toThrow();
  });
});

describe("parseEventSource", () => {
  it("parses full frontmatter, keeping when/finish verbatim", () => {
    const parsed = parseEventSource(
      [
        "---",
        "name: Annual General Meeting",
        "when: 2025-02-22T13:00+00:00",
        "finish: 2025-02-22T15:00+00:00",
        "location: Tynemouth Social Club",
        "---",
        "",
        "Notice is given.",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      name: "Annual General Meeting",
      when: "2025-02-22T13:00+00:00",
      finish: "2025-02-22T15:00+00:00",
      location: "Tynemouth Social Club",
      body: "Notice is given.",
    });
    // The corpus' minutes-precision offset format must satisfy the
    // metadata schema the content API enforces.
    expect(() =>
      eventMetadataSchema.parse({ when: parsed.when, finish: parsed.finish }),
    ).not.toThrow();
  });

  it("treats finish and location as optional", () => {
    const parsed = parseEventSource(
      [
        "---",
        "name: Nets",
        "when: 2026-01-07T20:30+00:00",
        "---",
        "Body.",
      ].join("\n"),
    );
    expect(parsed.finish).toBeUndefined();
    expect(parsed.location).toBeUndefined();
  });
});

describe("resolveLocation", () => {
  const locations = [
    {
      id: "first",
      name: "Tynemouth Social Club",
      street: "15-16 Front Street",
      city: "Tynemouth",
      county: "Tyne and Wear",
      country: "United Kingdom",
      postcode: "NE30 4DX",
      lat: 55.01779,
      lon: -1.42502,
    },
    {
      id: "other",
      name: "Monkseaton CC",
      street: "Hartley Avenue",
      city: "Monkseaton",
      county: "Northumberland",
      country: null,
      postcode: "NE26 3NT",
      lat: 55.046,
      lon: -1.462,
    },
    {
      id: "second",
      name: "Tynemouth Social Club",
      street: "15-16 Front St",
      city: "Tynemouth",
      county: "Tyne and Wear",
      country: "United Kingdom",
      postcode: "NE304DX",
      lat: 55.01782,
      lon: -1.42496,
    },
  ];

  it("takes the first match on duplicate names and drops county/country", () => {
    const resolved = resolveLocation(locations, "Tynemouth Social Club");
    expect(resolved).toEqual({
      name: "Tynemouth Social Club",
      street: "15-16 Front Street",
      city: "Tynemouth",
      postcode: "NE30 4DX",
      lat: 55.01779,
      lon: -1.42502,
    });
    // The embed must satisfy the event metadata schema.
    expect(() =>
      eventMetadataSchema.parse({
        when: "2025-02-22T13:00+00:00",
        location: resolved,
      }),
    ).not.toThrow();
  });

  it("returns undefined for an unknown name", () => {
    expect(resolveLocation(locations, "Lords")).toBeUndefined();
  });

  it("omits absent lat/lon rather than embedding nulls", () => {
    const resolved = resolveLocation(
      [
        {
          name: "X",
          street: "S",
          city: "C",
          postcode: "P",
          lat: null,
          lon: null,
        },
      ],
      "X",
    );
    expect(resolved).toEqual({
      name: "X",
      street: "S",
      city: "C",
      postcode: "P",
    });
  });

  it("flags duplicate names", () => {
    expect(findDuplicateLocationNames(locations)).toEqual([
      "Tynemouth Social Club",
    ]);
  });
});

describe("published_at derivation", () => {
  it("news dates become midnight Europe/London (GMT in winter)", () => {
    expect(newsPublishedAt("2025-01-10").toISOString()).toBe(
      "2025-01-10T00:00:00.000Z",
    );
  });

  it("news dates become midnight Europe/London (BST in summer)", () => {
    expect(newsPublishedAt("2025-06-24").toISOString()).toBe(
      "2025-06-23T23:00:00.000Z",
    );
  });

  it("a past event publishes from its start time", () => {
    const now = new Date("2026-06-11T12:00:00Z");
    expect(eventPublishedAt("2025-02-22T13:00+00:00", now).toISOString()).toBe(
      "2025-02-22T13:00:00.000Z",
    );
  });

  it("a future event publishes immediately", () => {
    const now = new Date("2026-06-11T12:00:00Z");
    expect(eventPublishedAt("2027-01-01T13:00+00:00", now)).toEqual(now);
  });

  it("rejects unparseable starts", () => {
    expect(() => eventPublishedAt("not-a-date", new Date())).toThrow(
      /Unparseable event start/,
    );
  });
});

describe("imageIdForAsset", () => {
  it("derives a stable RFC 4122 v5 uuid from the public path", () => {
    const id = imageIdForAsset("/images/contentful/abc/photo.jpeg");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(imageIdForAsset("/images/contentful/abc/photo.jpeg")).toBe(id);
    expect(imageIdForAsset("/images/contentful/def/photo.jpeg")).not.toBe(id);
  });
});

describe("jsonEqual", () => {
  it("ignores object key order at any depth", () => {
    expect(
      jsonEqual(
        { tags: ["a", "b"], authorSlug: "x" },
        { authorSlug: "x", tags: ["a", "b"] },
      ),
    ).toBe(true);
    expect(
      jsonEqual(
        { location: { name: "n", lat: 1 }, when: "w" },
        { when: "w", location: { lat: 1, name: "n" } },
      ),
    ).toBe(true);
  });

  it("detects real differences", () => {
    expect(jsonEqual({ tags: ["a"] }, { tags: ["a", "b"] })).toBe(false);
    expect(jsonEqual({ tags: ["a", "b"] }, { tags: ["b", "a"] })).toBe(false);
  });
});
