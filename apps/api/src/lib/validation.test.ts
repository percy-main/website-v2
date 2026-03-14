import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseBody, parseQuery, parseParams } from "./validation.js";
import type { FastifyRequest } from "fastify";

function mockRequest(
  overrides: Partial<Pick<FastifyRequest, "body" | "query" | "params">> = {},
): FastifyRequest {
  return {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
  } as FastifyRequest;
}

describe("parseBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  it("returns parsed data for valid body", () => {
    const req = mockRequest({ body: { name: "Alice", age: 30 } });
    const result = parseBody(req, schema);
    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("throws with statusCode 400 for invalid body", () => {
    const req = mockRequest({ body: { name: "", age: -1 } });
    expect(() => parseBody(req, schema)).toThrow();
    try {
      parseBody(req, schema);
    } catch (err: unknown) {
      const e = err as Error & { statusCode: number; validation: unknown[] };
      expect(e.statusCode).toBe(400);
      expect(e.validation).toBeDefined();
      expect(e.validation.length).toBeGreaterThan(0);
    }
  });

  it("strips extra fields", () => {
    const req = mockRequest({ body: { name: "Bob", age: 25, extra: "field" } });
    const result = parseBody(req, schema);
    expect(result).toEqual({ name: "Bob", age: 25 });
    expect(result).not.toHaveProperty("extra");
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    search: z.string().optional(),
  });

  it("coerces string query params to numbers", () => {
    const req = mockRequest({ query: { page: "3" } });
    const result = parseQuery(req, schema);
    expect(result.page).toBe(3);
  });

  it("applies defaults for missing params", () => {
    const req = mockRequest({ query: {} });
    const result = parseQuery(req, schema);
    expect(result.page).toBe(1);
  });
});

describe("parseParams", () => {
  const schema = z.object({ id: z.string().min(1) });

  it("parses valid route params", () => {
    const req = mockRequest({ params: { id: "abc-123" } });
    const result = parseParams(req, schema);
    expect(result.id).toBe("abc-123");
  });

  it("throws for missing params", () => {
    const req = mockRequest({ params: {} });
    expect(() => parseParams(req, schema)).toThrow();
  });
});
