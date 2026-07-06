import type { PictureSource } from "@/components/optimised-image.js";

// The photoGallery block's `images` prop: a JSON-stringified array of
// { picture, alt?, caption? }, following the contentImage `picture`
// JSON-string-prop precedent. Shared between the public renderer
// (content-body.tsx) and the editor block (content-editor.tsx) so both
// parse identically.

export interface GalleryImage {
  picture: PictureSource;
  alt?: string;
  caption?: string;
}

/** Accessible name for a gallery strip thumbnail. Shared by the public
 * gallery and the editor block; lives here rather than in the component
 * files so they only export components (Fast Refresh). */
export function galleryThumbLabel(image: GalleryImage, i: number): string {
  return `Show photo ${String(i + 1)}${image.alt ? `: ${image.alt}` : ""}`;
}

/**
 * Mirrors the public renderer's isSafeImageSrc (and the shared package's
 * SAFE_IMAGE_SRC): images render only from https or site-relative paths
 * (uploads live under /uploads/*).
 */
const SAFE_IMAGE_SRC = /^(?:https:|\/(?!\/))/i;

function safeSrcset(srcset: unknown): srcset is string {
  if (typeof srcset !== "string") return false;
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .every((url) => url !== undefined && SAFE_IMAGE_SRC.test(url));
}

/** Validate one stored picture descriptor, rebuilding it cleanly so no
 * extra stored keys ride along. The descriptor is stored content, so
 * every URL in it is checked - same rules as content-body's
 * parsePicture. */
function parsePictureValue(value: unknown): PictureSource | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as {
    sources?: unknown;
    img?: { src?: unknown; w?: unknown; h?: unknown };
  };
  if (
    typeof candidate.img?.src !== "string" ||
    !SAFE_IMAGE_SRC.test(candidate.img.src) ||
    typeof candidate.img.w !== "number" ||
    typeof candidate.img.h !== "number" ||
    typeof candidate.sources !== "object" ||
    candidate.sources === null
  ) {
    return null;
  }
  const sources: Record<string, string> = {};
  for (const [format, srcset] of Object.entries(candidate.sources)) {
    if (!safeSrcset(srcset)) return null;
    sources[format] = srcset;
  }
  return {
    sources,
    img: {
      src: candidate.img.src,
      w: candidate.img.w,
      h: candidate.img.h,
    },
  };
}

/**
 * Parse a JSON-stringified photoGallery images prop. Returns null for
 * anything that is not a wholly valid, non-empty array of
 * { picture, alt?, caption? } - malformed stored content degrades to
 * nothing, never crashes, per the renderer's conventions. Empty arrays
 * are null so the renderer and editor agree on the empty state.
 * Alt and caption are kept verbatim (the editor round-trips images
 * through this parser on every keystroke); empty strings are dropped
 * (NULL-for-unset).
 */
export function parseGalleryImages(
  raw: string | undefined,
): GalleryImage[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const images: GalleryImage[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { picture, alt, caption } = item as {
      picture?: unknown;
      alt?: unknown;
      caption?: unknown;
    };
    const parsedPicture = parsePictureValue(picture);
    if (parsedPicture === null) return null;
    if (alt !== undefined && typeof alt !== "string") return null;
    if (caption !== undefined && typeof caption !== "string") return null;
    images.push({
      picture: parsedPicture,
      ...(alt ? { alt } : {}),
      ...(caption ? { caption } : {}),
    });
  }
  return images.length > 0 ? images : null;
}
