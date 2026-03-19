import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { createTestLogger } from "../../test/logger.ts";
import { healthRoutes } from "./routes.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("health routes (integration)", () => {
  it("returns ok with a connected database", async () => {
    const logger = createTestLogger();
    const app = Fastify({ logger: { level: "info", stream: logger.stream } });
    // Decorate with the test container's db so healthRoutes can use app.db
    app.decorate("db", ctx.db);
    await app.register(healthRoutes);

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; database: string }>();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");

    await app.close();
  });
});
