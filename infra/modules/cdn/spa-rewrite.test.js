import { describe, expect, it } from "vitest";
import { createHandler } from "./spa-rewrite.handler.js";

const handler = createHandler("https://api.v2.percymain.org");

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
    it("redirects apex to www", () => {
      const result = handler(makeEvent("/about", "percymain.org"));
      expect(result.statusCode).toBe(301);
      expect(result.headers.location.value).toBe(
        "https://www.percymain.org/about",
      );
    });

    it("redirects kit subdomain to vx-3", () => {
      const result = handler(makeEvent("/", "kit.percymain.org"));
      expect(result.statusCode).toBe(301);
      expect(result.headers.location.value).toBe(
        "https://vx-3.com/collections/percy-main-cricket-club",
      );
    });
  });

  describe("OG game page redirect", () => {
    it("redirects /games/:matchId to API OG page", () => {
      const result = handler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page",
      );
    });

    it("bypasses redirect when og=1 query param is set", () => {
      const result = handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          og: { value: "1" },
        }),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("forwards non-og query params to the OG page", () => {
      const result = handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          bbb: { value: "1" },
        }),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?bbb=1",
      );
    });

    it("strips the og param when forwarding (defensive — only set on bypass)", () => {
      const result = handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          foo: { value: "bar" },
        }),
      );
      expect(result.statusCode).toBe(302);
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?foo=bar",
      );
    });

    it("URL-encodes forwarded query values", () => {
      const result = handler(
        makeEvent("/calendar/game/12345", "www.percymain.org", {
          q: { value: "hello world & friends" },
        }),
      );
      expect(result.headers.location.value).toBe(
        "https://api.v2.percymain.org/api/og/game/12345/page?q=hello%20world%20%26%20friends",
      );
    });

    it("does not redirect non-game pages", () => {
      const result = handler(makeEvent("/about", "www.percymain.org"));
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("does not redirect game paths with non-numeric IDs", () => {
      const result = handler(
        makeEvent("/calendar/game/abc", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });

    it("does not redirect /calendar/game/ without an ID", () => {
      const result = handler(makeEvent("/calendar/game/", "www.percymain.org"));
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });
  });

  describe("OG redirect disabled when no API URL", () => {
    it("skips redirect when apiBaseUrl is empty", () => {
      const noApiHandler = createHandler("");
      const result = noApiHandler(
        makeEvent("/calendar/game/12345", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
      expect(result.statusCode).toBeUndefined();
    });
  });

  describe("SPA rewrite", () => {
    it("rewrites paths without file extensions to /index.html", () => {
      const result = handler(
        makeEvent("/members/profile", "www.percymain.org"),
      );
      expect(result.uri).toBe("/index.html");
    });

    it("does not rewrite paths with file extensions", () => {
      const result = handler(
        makeEvent("/assets/logo.png", "www.percymain.org"),
      );
      expect(result.uri).toBe("/assets/logo.png");
    });
  });
});
