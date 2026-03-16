import type { FastifyInstance } from "fastify";
import { readdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test/app.js";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";

let ctx: TestContext;
let app: FastifyInstance;
const emailDir = join(process.cwd(), ".emails");

beforeAll(async () => {
  ctx = await startTestContainer();
  app = await buildTestApp(ctx.db, ctx.dialect);
}, 30_000);

afterAll(async () => {
  await app.close();
  await stopTestContainer(ctx);
});

/** Remove any leftover dev emails so each test starts clean. */
beforeEach(async () => {
  const files = await readdir(emailDir).catch(() => []);
  await Promise.all(files.map((f) => rm(join(emailDir, f), { force: true })));
});

describe("auth registration email (integration)", () => {
  it("sends a verification email on sign-up", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        email: "newuser@example.com",
        password: "SuperSecure123!",
        name: "Test User",
      },
    });

    expect(res.statusCode).toBe(200);

    // Dev email provider writes .html + .json files to .emails/
    const files = await readdir(emailDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThanOrEqual(1);

    const meta = JSON.parse(
      await readFile(join(emailDir, jsonFiles[0]), "utf-8"),
    ) as { to: string; subject: string };
    expect(meta.to).toBe("newuser@example.com");
    expect(meta.subject).toBe("Verify your email address");

    // The HTML should be a properly rendered email, not an error template
    const htmlFiles = files.filter((f) => f.endsWith(".html"));
    expect(htmlFiles.length).toBeGreaterThanOrEqual(1);
    const html = await readFile(join(emailDir, htmlFiles[0]), "utf-8");

    expect(html).not.toContain("React is not defined");
    expect(html).not.toContain("server rendering errored");
    expect(html).toContain("Verify Your Email");
    expect(html).toContain("Test User");
  });
});
