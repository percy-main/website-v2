import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test/app.ts";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";

/**
 * HTTP-level checks for the club-wide-only gates added in #627.
 *
 * These run the real stack - better-auth sessions, requireAuth,
 * requireClubWidePermission - rather than calling services, because the
 * boundary under test IS the preHandler: both routes are reachable with the
 * generic permission and are supposed to be refused anyway.
 *
 * Two rules are asserted:
 *  - juniors: `junior_manager` is team-scoped, and there is no
 *    dependent-to-junior-team association to scope the admin juniors tab by,
 *    so it is club-wide-only. That tab lists every minor in the club plus
 *    guardian contact details.
 *  - reimbursement: paying a claim out is a whole-club treasurer action, so a
 *    team-scoped `official` is refused even for their own team.
 */

let ctx: TestContext;
let app: Awaited<ReturnType<typeof buildTestApp>>;

const PASSWORD = "Sup3rSecure!password";

/** Sign up + verify + set role + sign in; returns the session cookie header. */
async function sessionFor(role: string): Promise<string> {
  const email = `${crypto.randomUUID()}@example.com`;
  const signUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: PASSWORD, name: `Test ${role}` },
  });
  expect(signUp.statusCode).toBe(200);

  await ctx.db
    .updateTable("user")
    .set({ role, emailVerified: true })
    .where("email", "=", email)
    .execute();

  const signIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email, password: PASSWORD },
  });
  expect(signIn.statusCode).toBe(200);

  const setCookie = signIn.headers["set-cookie"];
  const raw = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string"
      ? [setCookie]
      : [];
  const cookie = raw
    .map((entry) => entry.split(";")[0])
    .filter(Boolean)
    .join("; ");
  expect(cookie).not.toBe("");
  return cookie;
}

beforeAll(async () => {
  ctx = await startTestContainer();
  app = await buildTestApp(ctx.db, ctx.dialect);
}, 120_000);

afterAll(async () => {
  await app.close();
  await stopTestContainer(ctx);
});

describe("juniors endpoints are club-wide only (#627)", () => {
  /**
   * Every juniors route, with a payload where the method needs one. The
   * link/unlink bodies point at ids that don't exist: a club-wide caller is
   * expected to get past the gate and fail on the data, which is exactly what
   * distinguishes "refused at the door" from "allowed in".
   */
  const routes = [
    { method: "GET" as const, url: "/api/admin/juniors" },
    {
      method: "GET" as const,
      // Schema validation runs before preHandler, so every request here has
      // to be well-formed or a 400 would mask the gate under test.
      url: `/api/admin/juniors/search-users?dependentId=dep-${crypto.randomUUID()}`,
    },
    {
      method: "POST" as const,
      url: "/api/admin/juniors/link",
      payload: {
        dependentId: `dep-${crypto.randomUUID()}`,
        userId: `user-${crypto.randomUUID()}`,
      },
    },
    {
      method: "POST" as const,
      url: "/api/admin/juniors/unlink",
      payload: { dependentId: `dep-${crypto.randomUUID()}` },
    },
  ];

  it.each(routes)(
    "403s a team-scoped junior_manager on $method $url",
    async ({ method, url, payload }) => {
      const cookie = await sessionFor("junior_manager");
      const res = await app.inject({
        method,
        url,
        headers: { cookie },
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it("lets a club-wide juniors_admin through to the listing", async () => {
    const cookie = await sessionFor("juniors_admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/juniors",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("lets juniors_viewer read but not link", async () => {
    const cookie = await sessionFor("juniors_viewer");

    const read = await app.inject({
      method: "GET",
      url: "/api/admin/juniors",
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);

    // juniors_viewer is club-wide but has no manage action.
    const link = await app.inject({
      method: "POST",
      url: "/api/admin/juniors/link",
      headers: { cookie },
      payload: {
        dependentId: `dep-${crypto.randomUUID()}`,
        userId: `user-${crypto.randomUUID()}`,
      },
    });
    expect(link.statusCode).toBe(403);
  });

  it("does not leak dependent PII in the refusal body", async () => {
    const cookie = await sessionFor("junior_manager");
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/juniors",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Forbidden" });
  });
});

describe("expense reimbursement is club-wide only (#627)", () => {
  it("403s a team-scoped official", async () => {
    const cookie = await sessionFor("official");
    const res = await app.inject({
      method: "POST",
      url: `/api/matchday/expenses/${crypto.randomUUID()}/reimburse`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets a club-wide matchday_admin past the gate", async () => {
    const cookie = await sessionFor("matchday_admin");
    const res = await app.inject({
      method: "POST",
      url: `/api/matchday/expenses/${crypto.randomUUID()}/reimburse`,
      headers: { cookie },
    });
    // Past the permission gate, so it fails on the missing expense instead.
    expect(res.statusCode).toBe(404);
  });

  it("still lets a team-scoped official approve and reject", async () => {
    const cookie = await sessionFor("official");

    // Not 403: the approve/reject gates stay on the generic permission and
    // the team scope is enforced inside the service, which 404s an id the
    // official can't reach.
    const approve = await app.inject({
      method: "POST",
      url: `/api/matchday/expenses/${crypto.randomUUID()}/approve`,
      headers: { cookie },
    });
    expect(approve.statusCode).toBe(404);

    const reject = await app.inject({
      method: "POST",
      url: `/api/matchday/expenses/${crypto.randomUUID()}/reject`,
      headers: { cookie },
      payload: { reason: "No receipt" },
    });
    expect(reject.statusCode).toBe(404);
  });
});
