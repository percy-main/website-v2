import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BlockSettings,
  INLINE_TEXT_INPUT_CLASSES,
  PickerCard,
} from "./block-controls.js";

describe("BlockSettings", () => {
  it("renders the gear trigger with its accessible name by default", () => {
    const html = renderToStaticMarkup(
      <BlockSettings label="Image settings" title="Image">
        <input aria-label="Alt text" />
      </BlockSettings>,
    );
    expect(html).toContain('aria-label="Image settings"');
  });

  it("renders a custom trigger instead of the gear when provided", () => {
    const html = renderToStaticMarkup(
      <BlockSettings
        label="League table settings"
        title="League table"
        trigger={(open) => (
          <button type="button" onClick={open}>
            Set up league table
          </button>
        )}
      >
        <input aria-label="Division ID" />
      </BlockSettings>,
    );
    expect(html).toContain("Set up league table");
    expect(html).not.toContain('aria-label="League table settings"');
  });
});

describe("PickerCard", () => {
  it("renders the dashed card trigger with its prompt", () => {
    const html = renderToStaticMarkup(
      <PickerCard
        label="Choose a game to preview"
        prompt="Choose game"
        options={[{ value: "g1", label: "Firsts vs Seconds" }]}
        onPick={() => {
          /* static render - never fired */
        }}
      />,
    );
    expect(html).toContain('aria-label="Choose a game to preview"');
    expect(html).toContain("Choose game");
  });

  it("renders nothing when there is nothing left to pick", () => {
    const html = renderToStaticMarkup(
      <PickerCard
        label="Add a person to the grid"
        prompt="Add person"
        options={[]}
        onPick={() => {
          /* static render - never fired */
        }}
      />,
    );
    expect(html).toBe("");
  });
});

describe("INLINE_TEXT_INPUT_CLASSES", () => {
  it("lets the caller's text classes win over the base ones", () => {
    const classes = INLINE_TEXT_INPUT_CLASSES("w-auto text-blue-900");
    expect(classes).toContain("w-auto");
    expect(classes).not.toContain("w-full");
    expect(classes).toContain("border-transparent");
  });
});
