import type { PictureSource } from "@/components/optimised-image.js";

/**
 * Map old public `/images/...` paths to optimised vite-imagetools picture sources.
 *
 * Uses import.meta.glob to eagerly import all images from src/assets/images/
 * with vite-imagetools processing.
 */

// Optimised picture sources (AVIF + WebP + fallback, multiple widths)
const pictureModules = import.meta.glob<{ default: PictureSource }>(
  "../assets/images/**/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    query: {
      w: "320;640;960;1280;1920",
      format: "avif;webp;jpg",
      as: "picture",
    },
  },
);

// Plain URL imports for canvas/programmatic usage
const urlModules = import.meta.glob<{ default: string }>(
  "../assets/images/**/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    import: "default",
    query: { url: true },
  },
);

/**
 * Converts a glob key like `../assets/images/contentful/abc/photo.jpg`
 * to the old public path `/images/contentful/abc/photo.jpg`.
 */
function globKeyToPublicPath(key: string): string {
  return key.replace("../assets/images/", "/images/");
}

/** Map from old public path → optimised PictureSource */
const pictureMap = new Map<string, PictureSource>();
for (const [key, mod] of Object.entries(pictureModules)) {
  pictureMap.set(globKeyToPublicPath(key), mod.default);
}

/** Map from old public path → resolved asset URL */
const urlMap = new Map<string, string>();
for (const [key, url] of Object.entries(urlModules)) {
  urlMap.set(globKeyToPublicPath(key), url as unknown as string);
}

/**
 * Look up the optimised picture source for an image path.
 * Returns undefined if the path is not in the asset map.
 */
export function getPicture(path: string): PictureSource | undefined {
  return pictureMap.get(path);
}

/**
 * Look up the resolved URL for an image path (for canvas/programmatic use).
 * Returns the original path as fallback if not found.
 */
export function getImageUrl(path: string): string {
  return urlMap.get(path) ?? path;
}
