import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorBlockPreview } from "./editor-block-preview.js";

describe("EditorBlockPreview", () => {
  it("marks the wrapper inert so nested controls are not focusable or activatable", () => {
    const html = renderToStaticMarkup(
      <EditorBlockPreview>
        <button type="button">should be unreachable</button>
      </EditorBlockPreview>,
    );
    // React 19 renders the boolean inert prop as a bare attribute. inert
    // blocks focus, keyboard activation and pointer events, and carries
    // aria-hidden semantics - the keyboard half of read-only previews.
    expect(html).toMatch(/<div[^>]*\binert\b/);
    // pointer-events-none stays as a fallback for partial inert support.
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("should be unreachable");
  });

  it("merges extra classes onto the wrapper", () => {
    const html = renderToStaticMarkup(
      <EditorBlockPreview className="my-2 w-full">
        <span>preview</span>
      </EditorBlockPreview>,
    );
    expect(html).toContain("my-2");
    expect(html).toContain("w-full");
    expect(html).toContain("pointer-events-none");
  });
});
