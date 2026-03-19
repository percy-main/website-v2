import { describe, expect, it } from "vitest";
import { toWebHeaders } from "./middleware.ts";

describe("Auth middleware", () => {
  it("toWebHeaders converts fastify headers to Web Headers", () => {
    const fastifyHeaders = {
      "content-type": "application/json",
      authorization: "Bearer token123",
      accept: "text/html",
    };

    const headers = toWebHeaders(fastifyHeaders);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token123");
    expect(headers.get("accept")).toBe("text/html");
  });

  it("toWebHeaders handles array headers", () => {
    const fastifyHeaders = {
      "set-cookie": ["a=1", "b=2"],
    };

    const headers = toWebHeaders(fastifyHeaders);
    // Headers.getAll isn't standard, but append should work
    expect(headers.get("set-cookie")).toContain("a=1");
  });

  it("toWebHeaders skips undefined values", () => {
    const fastifyHeaders = {
      "content-type": "application/json",
      "x-custom": undefined,
    };

    const headers = toWebHeaders(fastifyHeaders);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("x-custom")).toBe(false);
  });
});
