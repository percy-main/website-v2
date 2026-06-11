import { describe, expect, it } from "vitest";
import { blocksToLines, detailLines, diffLines } from "./revision-diff.js";

const text = (t: string) => [{ type: "text", text: t, styles: {} }];

describe("blocksToLines", () => {
  it("projects common block types to readable lines", () => {
    const body = [
      {
        id: "1",
        type: "heading",
        props: { level: 2 },
        content: text("Ground rules"),
        children: [],
      },
      {
        id: "2",
        type: "paragraph",
        props: {},
        content: text("Be kind."),
        children: [],
      },
      {
        id: "3",
        type: "bulletListItem",
        props: {},
        content: text("No spikes indoors"),
        children: [
          {
            id: "3a",
            type: "bulletListItem",
            props: {},
            content: text("Even on Sundays"),
            children: [],
          },
        ],
      },
      {
        id: "4",
        type: "contentImage",
        props: { alt: "The pavilion", caption: "Summer 2025" },
        children: [],
      },
      {
        id: "5",
        type: "person",
        props: { slug: "alex-young", role: "Captain" },
        children: [],
      },
    ];
    expect(blocksToLines(body)).toEqual([
      "## Ground rules",
      "Be kind.",
      "- No spikes indoors",
      "  - Even on Sundays",
      "[Photo: The pavilion - Summer 2025]",
      "[Person card: alex-young (Captain)]",
    ]);
  });

  it("flattens link text into the line", () => {
    const body = [
      {
        id: "1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "See the ", styles: {} },
          { type: "link", href: "/fixtures", content: text("fixtures") },
        ],
        children: [],
      },
    ];
    expect(blocksToLines(body)).toEqual(["See the fixtures"]);
  });

  it("projects tables row by row", () => {
    const body = [
      {
        id: "1",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          rows: [
            { cells: [text("Team"), text("Points")] },
            { cells: [{ content: text("Firsts") }, { content: text("42") }] },
          ],
        },
        children: [],
      },
    ];
    expect(blocksToLines(body)).toEqual([
      "| Team | Points |",
      "| Firsts | 42 |",
    ]);
  });

  it("covers every render-relevant custom-block prop, so a prop-only change always diffs", () => {
    const block = (type: string, props: Record<string, unknown>) => [
      { id: "1", type, props, children: [] },
    ];
    // A role change inside a person grid (entries is canonical)
    expect(
      blocksToLines(
        block("personGrid", {
          slugs: "a,b",
          entries: '[{"slug":"a","role":"Captain"},{"slug":"b"}]',
        }),
      ),
    ).not.toEqual(
      blocksToLines(
        block("personGrid", {
          slugs: "a,b",
          entries: '[{"slug":"a"},{"slug":"b"}]',
        }),
      ),
    );
    // A replaced photo with identical alt/caption
    expect(
      blocksToLines(
        block("contentImage", { alt: "x", caption: "", src: "/uploads/a.jpg" }),
      ),
    ).not.toEqual(
      blocksToLines(
        block("contentImage", { alt: "x", caption: "", src: "/uploads/b.jpg" }),
      ),
    );
    // An event preview repointed at a different event, same display name
    expect(
      blocksToLines(
        block("eventPreview", {
          eventId: "e1",
          name: "AGM",
          when: "2026-01-01",
        }),
      ),
    ).not.toEqual(
      blocksToLines(
        block("eventPreview", {
          eventId: "e2",
          name: "AGM",
          when: "2026-01-01",
        }),
      ),
    );
  });

  it("degrades malformed input to empty output rather than throwing", () => {
    expect(blocksToLines(null)).toEqual([]);
    expect(blocksToLines("not blocks")).toEqual([]);
    // Non-object entries vanish; an object with a junk type degrades to
    // a blank text line.
    expect(blocksToLines([null, 7, { type: 9 }])).toEqual([""]);
  });
});

describe("detailLines", () => {
  it("sorts metadata keys so JSONB key-order churn never reads as a change", () => {
    const a = detailLines({
      title: "T",
      description: null,
      metadata: { tags: ["x"], authorSlug: "a" },
    });
    const b = detailLines({
      title: "T",
      description: null,
      metadata: { authorSlug: "a", tags: ["x"] },
    });
    expect(a).toEqual(b);
    expect(a[0]).toBe("Title: T");
    expect(a[1]).toBe("Description: ");
  });
});

describe("diffLines", () => {
  it("marks the deleted paragraph - the recovery scenario", () => {
    const revision = ["Intro", "The lost paragraph.", "Outro"];
    const current = ["Intro", "Outro"];
    expect(diffLines(revision, current)).toEqual([
      { type: "same", text: "Intro" },
      { type: "removed", text: "The lost paragraph." },
      { type: "same", text: "Outro" },
    ]);
  });

  it("marks additions since the revision", () => {
    expect(diffLines(["a"], ["a", "b"])).toEqual([
      { type: "same", text: "a" },
      { type: "added", text: "b" },
    ]);
  });

  it("handles a full replacement", () => {
    expect(diffLines(["old"], ["new"])).toEqual([
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
    ]);
  });

  it("handles empty sides", () => {
    expect(diffLines([], ["a"])).toEqual([{ type: "added", text: "a" }]);
    expect(diffLines(["a"], [])).toEqual([{ type: "removed", text: "a" }]);
    expect(diffLines([], [])).toEqual([]);
  });
});
