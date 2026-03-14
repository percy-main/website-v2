import { describe, expect, it } from "vitest";

describe("Health routes", () => {
  it("should be importable", async () => {
    const { healthRoutes } = await import("./routes.js");
    expect(healthRoutes).toBeDefined();
    expect(typeof healthRoutes).toBe("function");
  });
});
