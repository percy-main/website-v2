import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { healthRoutes } from "./routes.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("health routes (integration)", () => {
  it("returns ok with a connected database", async () => {
    const app = Fastify({ logger: false });
    // Decorate with the test container's db so healthRoutes can use app.db
    app.decorate("db", ctx.db);
    await app.register(healthRoutes);

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.json().database).toBe("connected");

    await app.close();
  });
});
