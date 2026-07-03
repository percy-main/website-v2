import type { ManifestItem } from "./reconcile.js";

// sitemap.xml for the public site, rebuilt by every prerender sync from
// the same manifest that drives rendering. Served straight from the
// frontend bucket ("/sitemap.xml" has an extension, so the CloudFront
// SPA rewrite passes it through untouched).

/**
 * Evergreen app routes that are not CMS content but should be crawled.
 * The home page tops the list; the rest are the stable public sections
 * and the recruitment landing pages.
 */
const EVERGREEN_ROUTES = [
  "/",
  "/news/1",
  "/calendar",
  "/person",
  "/tell-me-about",
  "/tell-me-about/mens-cricket",
  "/tell-me-about/womens-cricket",
  "/tell-me-about/junior-boys",
  "/tell-me-about/junior-girls",
] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

export function buildSitemap(
  items: ReadonlyArray<Pick<ManifestItem, "url" | "updatedAt">>,
  origin = "https://www.percymain.org",
): string {
  const urls: string[] = [];

  for (const route of EVERGREEN_ROUTES) {
    urls.push(`  <url><loc>${escapeXml(`${origin}${route}`)}</loc></url>`);
  }

  for (const item of items) {
    const lastmod = item.updatedAt.slice(0, 10);
    urls.push(
      `  <url><loc>${escapeXml(`${origin}${item.url}`)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`,
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
