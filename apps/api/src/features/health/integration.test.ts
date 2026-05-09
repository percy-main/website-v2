import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
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
  async function buildApp() {
    const logger = createTestLogger();
    const app = Fastify({ logger: { level: "info", stream: logger.stream } });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("db", ctx.db);
    await app.register(healthRoutes);
    return app;
  }

  it("/health/live returns 200 ok regardless of DB", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>()).toEqual({ status: "ok" });
    await app.close();
  });

  it("/health/ready returns 200 with a connected database", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; database: string }>();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");
    await app.close();
  });

  it("/health (legacy) returns 200 with a connected database", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; database: string }>();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");
    await app.close();
  });
});
