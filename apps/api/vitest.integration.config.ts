import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/test/e2e.test.ts",
      "src/features/junior/routes.test.ts",
      "src/features/leaderboard/routes.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
});
