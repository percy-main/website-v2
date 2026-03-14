import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/test/e2e.test.ts",
      "src/features/junior/routes.test.ts",
      "src/features/leaderboard/routes.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/features/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**"],
    },
    setupFiles: ["./src/test/setup.ts"],
  },
});
