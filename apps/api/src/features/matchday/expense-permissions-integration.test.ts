import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test/app.ts";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";

/** HTTP-level checks for the reimbursement permission boundary in #627. */

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

describe("expense reimbursement requires finance administration (#627)", () => {
  it.each(["official", "matchday_admin", "finance_viewer"])(
    "403s %s",
    async (role) => {
      const cookie = await sessionFor(role);
      const res = await app.inject({
        method: "POST",
        url: `/api/matchday/expenses/${crypto.randomUUID()}/reimburse`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it("lets finance_admin past the gate", async () => {
    const cookie = await sessionFor("finance_admin");
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
