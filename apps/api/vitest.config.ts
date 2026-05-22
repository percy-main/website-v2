import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/integration.test.ts",
      "**/*-integration.test.ts",
      "**/*.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/features/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/test/**",
      ],
    },
    setupFiles: ["./src/test/setup.ts"],
    // CI-only JUnit output → consumed by publish-unit-test-result-action
    // in _lint-test-build.yml so failed tests annotate the PR on the
    // offending line. Local runs keep the default streaming reporter.
    reporters: process.env.CI
      ? ["default", ["junit", { outputFile: "./test-results/api-unit.xml" }]]
      : ["default"],
  },
});
