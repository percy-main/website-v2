import { describe, expect, it } from "vitest";
import { buildSitemap } from "./sitemap.js";

describe("buildSitemap", () => {
  const xml = buildSitemap(
    [
      { url: "/club/history", updatedAt: "2026-06-02T10:30:00.000Z" },
      { url: "/news/article/a&b", updatedAt: "2026-06-03T10:30:00.000Z" },
    ],
    "https://www.percymain.org",
  );

  it("emits a urlset with evergreen routes and content items", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("<loc>https://www.percymain.org/</loc>");
    expect(xml).toContain("<loc>https://www.percymain.org/news/1</loc>");
    expect(xml).toContain(
      "<url><loc>https://www.percymain.org/club/history</loc><lastmod>2026-06-02</lastmod></url>",
    );
  });

  it("escapes XML-significant characters in URLs", () => {
    expect(xml).toContain("a&amp;b");
    expect(xml).not.toContain("a&b<");
  });
});
