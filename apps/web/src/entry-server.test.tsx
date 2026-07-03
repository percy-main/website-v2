import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// mdx-components transitively imports the vite-imagetools image map,
// which doesn't exist outside a Vite build - stub the lookups, the
// renderer only needs their shapes (same stance as content-body.test).
vi.mock("@/lib/image-map.js", () => ({
  getImageUrl: () => undefined,
  getPicture: () => undefined,
}));

import { render } from "./entry-server.js";

const NAV_DATA = {
  items: [
    { path: "/club", title: "The Club", menuOrder: 1, isMainMenu: true },
    {
      path: "/club/history",
      title: "History",
      menuOrder: 1,
      isMainMenu: false,
    },
  ],
  removed: [],
};

function paragraph(text: string) {
  return {
    id: `b-${text.length.toString()}`,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function seededClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["content", "nav"], NAV_DATA);
  return queryClient;
}

describe("entry-server render", () => {
  it("renders a CMS page with real content, chrome and no loading state", async () => {
    const queryClient = seededClient();
    queryClient.setQueryData(["content", "page", "/club/history"], {
      id: "11111111-1111-1111-1111-111111111111",
      kind: "page",
      slug: "history",
      title: "Club History",
      description: "How it all started.",
      body: [paragraph("Founded on the banks of the Tyne.")],
      metadata: { menuOrder: 1, isMainMenu: false, hideTitle: false },
      publishedAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-02T10:00:00.000Z",
    });

    const { appHtml, dehydratedState } = await render(
      "/club/history",
      queryClient,
    );

    // The page body and title are in the markup - crawlers see content.
    expect(appHtml).toContain("Founded on the banks of the Tyne.");
    expect(appHtml).toContain("Club History");
    // Site chrome rendered with the seeded nav: the header main-menu item
    // and the section sidebar both link to /club.
    expect(appHtml).toContain("The Club");
    expect(appHtml).toContain('href="/club"');
    // Nothing on the page is a spinner (PageLoading's animate-spin).
    expect(appHtml).not.toContain("animate-spin");
    // The dehydrated state carries both seeded queries for the take-over.
    const hashes = dehydratedState.queries.map((q) => q.queryHash);
    expect(hashes).toHaveLength(2);
    expect(hashes.join()).toContain("nav");
  });

  it("renders a news article", async () => {
    const queryClient = seededClient();
    queryClient.setQueryData(["content", "news", "season-opener"], {
      id: "22222222-2222-2222-2222-222222222222",
      kind: "news",
      slug: "season-opener",
      title: "Season Opener",
      description: "First game of the season.",
      body: [paragraph("A cracking start to the season.")],
      metadata: { tags: ["cricket"] },
      publishedAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    const { appHtml } = await render(
      "/news/article/season-opener",
      queryClient,
    );

    expect(appHtml).toContain("Season Opener");
    expect(appHtml).toContain("A cracking start to the season.");
    expect(appHtml).not.toContain("animate-spin");
  });

  it("renders the not-found view for an unseeded confirmed miss", async () => {
    const queryClient = seededClient();
    queryClient.setQueryData(["content", "page", "/nope"], null);

    const { appHtml } = await render("/nope", queryClient);

    expect(appHtml).toContain("Page Not Found");
  });
});
