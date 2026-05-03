import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireScoutAccess } from "./auth.ts";

vi.mock("../auth/middleware.ts", () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from "../auth/middleware.ts";

function makeReply() {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn();
  return { sent: false, status, send } as unknown as FastifyReply;
}

function makeRequest(opts: {
  email?: string;
  allowed?: string[];
}): FastifyRequest {
  return {
    authSession: opts.email ? { user: { email: opts.email } } : undefined,
    server: {
      config: {
        SCOUT_ALLOWED_EMAILS: opts.allowed ?? ["alex@alexyoung.info"],
      },
    },
  } as unknown as FastifyRequest;
}

describe("requireScoutAccess", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockReset();
    vi.mocked(requireAuth).mockResolvedValue(undefined);
  });

  it("short-circuits if requireAuth has already responded", async () => {
    const reply = makeReply();
    (reply as unknown as { sent: boolean }).sent = true;
    const request = makeRequest({});

    await requireScoutAccess(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("returns 403 when authed user is not on the allowlist", async () => {
    const reply = makeReply();
    const request = makeRequest({ email: "stranger@example.com" });

    await requireScoutAccess(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("returns 403 when authSession is missing after requireAuth (defensive)", async () => {
    const reply = makeReply();
    const request = makeRequest({});

    await requireScoutAccess(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("passes through when the authed user's email is on the allowlist", async () => {
    const reply = makeReply();
    const request = makeRequest({
      email: "alex@alexyoung.info",
      allowed: ["alex@alexyoung.info"],
    });

    await requireScoutAccess(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("matches case-sensitively (literal email comparison)", async () => {
    const reply = makeReply();
    const request = makeRequest({
      email: "ALEX@alexyoung.info",
      allowed: ["alex@alexyoung.info"],
    });

    await requireScoutAccess(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("supports a multi-entry allowlist", async () => {
    const reply = makeReply();
    const request = makeRequest({
      email: "captain@percymain.org",
      allowed: ["alex@alexyoung.info", "captain@percymain.org"],
    });

    await requireScoutAccess(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });
});
