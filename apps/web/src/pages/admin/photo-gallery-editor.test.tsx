import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GalleryImage } from "@/lib/photo-gallery.js";
import {
  PhotoGalleryEditor,
  UploadConsentContext,
} from "./photo-gallery-editor.js";

const image = (
  id: string,
  extras: Partial<GalleryImage> = {},
): GalleryImage => ({
  picture: {
    sources: {
      webp: `/uploads/content/${id}/320.webp 320w`,
    },
    img: { src: `/uploads/content/${id}/640.jpg`, w: 640, h: 480 },
  },
  ...extras,
});

function renderGallery(images: GalleryImage[]): string {
  return renderToStaticMarkup(
    <UploadConsentContext.Provider value={false}>
      <PhotoGalleryEditor
        images={images}
        onWrite={() => {
          /* static render - never fired */
        }}
      />
    </UploadConsentContext.Provider>,
  );
}

describe("PhotoGalleryEditor", () => {
  it("renders only the dashed add-photos card for an empty gallery", () => {
    const html = renderGallery([]);
    expect(html).toContain('aria-label="Add photos to the gallery"');
    expect(html).toContain("Add photos");
    expect(html).not.toContain("Caption for photo");
  });

  it("renders the selected photo's stage, caption input and toolbar", () => {
    const html = renderGallery([
      image("a", { alt: "The winning six", caption: "Scenes" }),
      image("b"),
    ]);
    expect(html).toContain('src="/uploads/content/a/640.jpg"');
    expect(html).toContain('aria-label="Caption for photo 1"');
    expect(html).toContain('value="Scenes"');
    expect(html).toContain("Photo 1 of 2");
    expect(html).toContain("Move left");
    expect(html).toContain("Move right");
    expect(html).toContain("Remove photo");
    expect(html).not.toContain("undefined");
  });

  it("renders a selectable thumbnail per photo plus the add tile", () => {
    const html = renderGallery([
      image("a", { alt: "The winning six" }),
      image("b"),
    ]);
    expect(html).toContain('aria-label="Show photo 1: The winning six"');
    expect(html).toContain('aria-label="Show photo 2"');
    expect(html).toContain('aria-label="Add photos to the gallery"');
  });

  it("marks the selected thumbnail with aria-current", () => {
    const html = renderGallery([image("a"), image("b")]);
    expect(html).toContain('aria-current="true"');
  });

  it("disables both move buttons for a single-photo gallery", () => {
    const html = renderGallery([image("a")]);
    // Exactly the two move buttons are disabled: a lone photo can't
    // move, and the add tile stays enabled.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("exposes the alt text field behind the settings gear", () => {
    const html = renderGallery([image("a", { alt: "The winning six" })]);
    expect(html).toContain('aria-label="Photo settings"');
  });
});
