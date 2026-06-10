import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // CI-only JUnit output → consumed by publish-unit-test-result-action
    // in _lint-test-build.yml (globs **/test-results/*.xml).
    reporters: process.env.CI
      ? ["default", ["junit", { outputFile: "./test-results/shared-unit.xml" }]]
      : ["default"],
  },
});
