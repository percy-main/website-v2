import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // No tests yet in this workspace — don't fail CI for the absence.
    // Drop this once we add the first .test.ts.
    passWithNoTests: true,
    reporters: process.env.CI
      ? [
          "default",
          ["junit", { outputFile: "./test-results/matchday-unit.xml" }],
        ]
      : ["default"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
