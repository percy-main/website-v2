import { describe, expect, it } from "vitest";
import {
  projectDraftBlocks,
  type EditorDocumentBlock,
} from "./draft-projection.ts";

const text = (value: string, styles: Record<string, unknown> = {}) => ({
  type: "text",
  text: value,
  styles,
});

describe("projectDraftBlocks", () => {
  it("flattens inline content to plain text and keeps ids/types", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "h1",
        type: "heading",
        props: { level: 2, textColor: "default" },
        content: [text("A fine "), text("win", { bold: true })],
        children: [],
      },
    ];
    expect(projectDraftBlocks(doc)).toEqual([
      {
        id: "h1",
        type: "heading",
        props: { level: 2 },
        content: "A fine win",
        hasFormatting: true,
      },
    ]);
  });

  it("flags links as formatting and flattens their inner text", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "p1",
        type: "paragraph",
        content: [
          text("See the "),
          { type: "link", href: "/fixtures", content: [text("fixtures")] },
        ],
        children: [],
      },
    ];
    const [block] = projectDraftBlocks(doc);
    expect(block.content).toBe("See the fixtures");
    expect(block.hasFormatting).toBe(true);
  });

  it("omits content and hasFormatting for unstyled empty blocks", () => {
    const doc: EditorDocumentBlock[] = [
      { id: "p1", type: "paragraph", content: [], children: [] },
    ];
    expect(projectDraftBlocks(doc)).toEqual([{ id: "p1", type: "paragraph" }]);
  });

  it("recurses into children", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "l1",
        type: "bulletListItem",
        content: [text("Top")],
        children: [
          {
            id: "l2",
            type: "bulletListItem",
            content: [text("Nested")],
            children: [],
          },
        ],
      },
    ];
    const [block] = projectDraftBlocks(doc);
    expect(block.children).toEqual([
      { id: "l2", type: "bulletListItem", content: "Nested" },
    ]);
  });

  it("projects tables with bare-array cells to string cells", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          columnWidths: [120, null],
          rows: [{ cells: [[text("Team")], [text("Points")]] }],
        },
        children: [],
      },
    ];
    const [block] = projectDraftBlocks(doc);
    expect(block.content).toEqual({
      type: "tableContent",
      columnWidths: [120, null],
      rows: [{ cells: ["Team", "Points"] }],
    });
  });

  it("projects tables with tableCell-object cells and flags cell formatting", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                { type: "tableCell", content: [text("Won", { bold: true })] },
              ],
            },
          ],
        },
        children: [],
      },
    ];
    const [block] = projectDraftBlocks(doc);
    expect(block.content).toEqual({
      type: "tableContent",
      rows: [{ cells: ["Won"] }],
    });
    expect(block.hasFormatting).toBe(true);
  });

  it("drops heavy/irrelevant props but keeps meaningful scalars", () => {
    const doc: EditorDocumentBlock[] = [
      {
        id: "img1",
        type: "contentImage",
        props: {
          src: "/uploads/x.jpg",
          alt: "The pavilion",
          caption: "",
          picture: '{"huge":"json"}',
        },
        children: [],
      },
      {
        id: "g1",
        type: "photoGallery",
        props: { images: '[{"huge":"json"}]' },
        children: [],
      },
      {
        id: "gp1",
        type: "gamePreview",
        props: { playCricketId: "123456", textAlignment: "left" },
        children: [],
      },
    ];
    const [image, gallery, game] = projectDraftBlocks(doc);
    expect(image.props).toEqual({ alt: "The pavilion" });
    expect(gallery.props).toBeUndefined();
    expect(game.props).toEqual({ playCricketId: "123456" });
  });

  it("caps runaway documents inside the schema limits", () => {
    const doc: EditorDocumentBlock[] = Array.from({ length: 600 }, (_, i) => ({
      id: `p${String(i)}`,
      type: "paragraph",
      content: [text("x".repeat(9_000))],
      children: [],
    }));
    const projected = projectDraftBlocks(doc);
    expect(projected).toHaveLength(500);
    expect((projected[0].content as string).length).toBe(8_000);
  });
});
