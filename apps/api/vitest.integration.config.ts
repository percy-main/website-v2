import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/integration.test.ts", "src/**/*-integration.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["./src/test/setup.ts"],
    reporters: process.env.CI
      ? [
          "default",
          ["junit", { outputFile: "./test-results/api-integration.xml" }],
        ]
      : ["default"],
  },
});
