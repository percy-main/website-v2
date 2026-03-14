import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";

describe("E2E: Health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok status", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBeDefined();
  });
});

describe("E2E: Public endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/play-cricket/teams returns teams", async () => {
    const res = await app.inject({ method: "GET", url: "/api/play-cricket/teams" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("teams");
    expect(Array.isArray(body.teams)).toBe(true);
  });

  it("GET /api/leaderboard returns entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leaderboard?game=be-the-keeper",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("entries");
  });

  it("GET /api/sponsorship/game/price returns price", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sponsorship/game/price",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("amountPence");
    expect(body).toHaveProperty("currency");
  });

  it("GET /api/sponsorship/player/price returns price", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sponsorship/player/price",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("amountPence");
  });

  it("POST /api/contact validates input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: { name: "", email: "bad", message: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/contact accepts valid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/contact",
      payload: {
        name: "Test User",
        email: "test@example.com",
        message: "Hello",
        page: "/about",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("id");
  });
});

describe("E2E: Auth-protected endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/members/me returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members/me" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/charges returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/charges" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/fantasy/team returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fantasy/team" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/membership returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/membership" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/junior/dependents returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/junior/dependents",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("E2E: Admin-protected endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/admin/users returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/treasurer/income-by-month returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/treasurer/income-by-month",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/fantasy/admin/players returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/fantasy/admin/players",
    });
    expect(res.statusCode).toBe(401);
  });
});
