import { describe, expect, it } from "vitest";
import { createHandler } from "./spa-rewrite.handler.js";

/**
 * Test double for the cloudfront runtime's KVS handle: get() resolves
 * for known keys and throws for missing ones, exactly like cf.kvs().
 */
function fakeKvs(keys) {
  return {
    get(key) {
      if (keys.includes(key)) return Promise.resolve("1");
      return Promise.reject(new Error(`KeyNotFound: ${key}`));
    },
  };
}

const handler = createHandler("https://api.v2.percymain.org", null);

function makeEvent(uri, host, querystring = {}) {
  return {
    request: {
      uri,
      headers: { host: { value: host } },
      querystring,
    },
  };
}

describe("spa-rewrite CloudFront function", () => {
  describe("domain redirects", () => {
    it("redirects apex to www", async () => {
      const result = await handler(makeEvent("/about", "percymain.org"));
      expect(result.statusCode).toBe(301);
      expect(result.headers.location.value).toBe(
        "https://www.percymain.org/about",
      );
    });

    it("redirects kit subdomain to vx-3", async () => {
      const result = await handler(makeEvent("/", "kit.percymain.org"));
      expect(result.statusCode).toBe(301);
      expect(result.headers.location.value).toBe(
        "https://vx-3.com/collections/percy-main-cricket-club",
      );
    });
  });

  describe("OG game page redirect", () => {
    it("redirects /games/:matchId to API OG page", async () => {
      const result = await handler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page",
      );
    });

    it("bypasses redirect when og=1 query param is set", async () => {
      const result = await handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          og: { value: "1" },
        }),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("forwards non-og query params to the OG page", async () => {
      const result = await handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          bbb: { value: "1" },
        }),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?bbb=1",
      );
    });

    it("strips the og param from forwarded query (only og=1 should round-trip via bypass)", async () => {
      const result = await handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          og: { value: "0" },
          foo: { value: "bar" },
        }),
      );
      expect(result.statusCode).toBe(302);
      // og must not appear in the forwarded URL — the OG page sets og=1
      // itself on the bypass redirect, so re-forwarding would let a caller
      // sneak a non-bypass og value into the SPA's URL bar.
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?foo=bar",
      );
    });

    it("URL-encodes forwarded query values", async () => {
      const result = await handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          q: { value: "hello world & friends" },
        }),
      );
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?q=hello%20world%20%26%20friends",
      );
    });

    it("does not redirect non-game pages", async () => {
      const result = await handler(makeEvent("/about", "www.percymain.org"));
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("does not redirect game paths with non-numeric IDs", async () => {
      const result = await handler(
        makeEvent("/calendar/game/abc", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("does not redirect /calendar/game/ without an ID", async () => {
      const result = await handler(
        makeEvent("/calendar/game/", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("serves the snapshot instead of the OG redirect when one exists", async () => {
      // Prerendered game pages carry their own OG meta, so the KVS
      // lookup runs first and a snapshot hit wins outright.
      const kvsHandler = createHandler(
        "https://api.v2.percymain.org",
        fakeKvs(["/calendar/game/12345"]),
      );
      const result = await kvsHandler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.uri).toBe("/_prerender/calendar/game/12345.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("serves the snapshot even with og=1 (stale bypass links)", async () => {
      const kvsHandler = createHandler(
        "https://api.v2.percymain.org",
        fakeKvs(["/calendar/game/12345"]),
      );
      const result = await kvsHandler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          og: { value: "1" },
        }),
      );
      expect(result.uri).toBe("/_prerender/calendar/game/12345.html");
    });

    it("keeps the OG redirect for games without a snapshot", async () => {
      // Past seasons and not-yet-rendered games: the store exists but
      // has no key for this game, so link previews still work via the
      // API OG page.
      const kvsHandler = createHandler(
        "https://api.v2.percymain.org",
        fakeKvs(["/club", "/calendar/game/99999"]),
      );
      const result = await kvsHandler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page",
      );
    });
  });

  describe("OG redirect disabled when no API URL", () => {
    it("skips redirect when apiBaseUrl is empty", async () => {
      const noApiHandler = createHandler("", null);
      const result = await noApiHandler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });
  });

  describe("prerender routing", () => {
    // KVS keys are exact public URL paths; the S3 object is derived by
    // convention ("/_prerender" + uri + ".html"). These fixtures are
    // pinned on the Lambda side too (apps/web/src/prerender/paths.test.ts).
    const kvsHandler = createHandler(
      "https://api.v2.percymain.org",
      fakeKvs(["/club", "/club/history", "/news/article/season-opener"]),
    );

    it("rewrites a snapshot URL to its prerendered object", async () => {
      const result = await kvsHandler(makeEvent("/club", "www.percymain.org"));
      expect(result.uri).toBe("/_prerender/club.html");
    });

    it("rewrites nested snapshot URLs", async () => {
      const result = await kvsHandler(
        makeEvent("/club/history", "www.percymain.org"),
      );
      expect(result.uri).toBe("/_prerender/club/history.html");
    });

    it("rewrites calendar month snapshot URLs", async () => {
      const monthHandler = createHandler(
        "https://api.v2.percymain.org",
        fakeKvs(["/calendar/2026/july"]),
      );
      const result = await monthHandler(
        makeEvent("/calendar/2026/july", "www.percymain.org"),
      );
      expect(result.uri).toBe("/_prerender/calendar/2026/july.html");
    });

    it("normalises a trailing slash before the lookup", async () => {
      const result = await kvsHandler(makeEvent("/club/", "www.percymain.org"));
      expect(result.uri).toBe("/_prerender/club.html");
    });

    it("falls back to the SPA shell on a KVS miss", async () => {
      const result = await kvsHandler(
        makeEvent("/fantasy", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
    });

    it("falls back to the SPA shell when the KVS handle throws", async () => {
      const broken = createHandler("https://api.v2.percymain.org", {
        get() {
          return Promise.reject(new Error("kvs unavailable"));
        },
      });
      const result = await broken(makeEvent("/club", "www.percymain.org"));
      expect(result.uri).toBe("/index.html");
    });

    it("never routes the root URL to a snapshot, even with a lying store", async () => {
      // The Lambda can never write a "/" key (isSnapshotUrl rejects it),
      // and the function skips the lookup at the root outright.
      const withRoot = createHandler("https://api.v2.percymain.org", {
        get() {
          return Promise.resolve("1");
        },
      });
      const result = await withRoot(makeEvent("/", "www.percymain.org"));
      expect(result.uri).toBe("/index.html");
    });

    it("returns 404 for direct hits on the snapshot prefix", async () => {
      const result = await kvsHandler(
        makeEvent("/_prerender/club.html", "www.percymain.org"),
      );
      expect(result.statusCode).toBe(404);
    });

    it("still serves static assets untouched", async () => {
      const result = await kvsHandler(
        makeEvent("/assets/logo.png", "www.percymain.org"),
      );
      expect(result.uri).toBe("/assets/logo.png");
    });
  });

  describe("SPA rewrite", () => {
    it("rewrites paths without file extensions to /index.html", async () => {
      const result = await handler(
        makeEvent("/members/profile", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
    });

    it("does not rewrite paths with file extensions", async () => {
      const result = await handler(
        makeEvent("/assets/logo.png", "www.percymain.org"),
      );
      expect(result.uri).toBe("/assets/logo.png");
    });
  });
});
