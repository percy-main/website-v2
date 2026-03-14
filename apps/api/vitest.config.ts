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
    ],
    coverage: {
      provider: "v8",
      include: ["src/features/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.integration.test.ts", "src/test/**"],
    },
    setupFiles: ["./src/test/setup.ts"],
  },
});
