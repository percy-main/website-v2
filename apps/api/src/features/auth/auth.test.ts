import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { requireClubWidePermission, toWebHeaders } from "./middleware.ts";

/** Minimal Fastify request/reply doubles that drive the auth preHandlers. */
function makeReqReply(role: string) {
  const session = { user: { role }, session: {} };
  let statusCode: number | undefined;
  let sent = false;
  const reply = {
    status(code: number) {
      statusCode = code;
      return reply;
    },
    send() {
      sent = true;
      return reply;
    },
    get sent() {
      return sent;
    },
  } as unknown as FastifyReply;
  const request = {
    headers: {},
    server: { auth: { api: { getSession: () => Promise.resolve(session) } } },
  } as unknown as FastifyRequest;
  return { request, reply, getStatus: () => statusCode };
}

describe("requireClubWidePermission", () => {
  it("403s a team-scoped official", async () => {
    const { request, reply, getStatus } = makeReqReply("official");
    await requireClubWidePermission("matchday", "manage")(request, reply);
    expect(getStatus()).toBe(403);
  });

  it("allows a club-wide matchday admin", async () => {
    const { request, reply, getStatus } = makeReqReply("matchday_admin");
    await requireClubWidePermission("matchday", "manage")(request, reply);
    expect(reply.sent).toBe(false);
    expect(getStatus()).toBeUndefined();
  });

  it("allows the legacy club-wide admin role", async () => {
    const { request, reply } = makeReqReply("admin");
    await requireClubWidePermission("matchday", "view")(request, reply);
    expect(reply.sent).toBe(false);
  });
});

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
