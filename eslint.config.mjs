import eslint from "@eslint/js";
import hooksPlugin from "eslint-plugin-react-hooks";
import reactDoctor from "react-doctor/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: {
      "react-hooks": hooksPlugin,
    },
    rules: hooksPlugin.configs.recommended.rules,
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // apps/web runs the React Compiler — recommended-latest's compiler-aware
  // ruleset replaces the legacy "exhaustive-deps as error" stance (the
  // compiler now handles dep tracking and function stability for us).
  // This block must come after the global "exhaustive-deps: error" override
  // above so its `warn` level wins for apps/web.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": hooksPlugin,
    },
    rules: hooksPlugin.configs["recommended-latest"].rules,
  },
  {
    rules: {
      "no-undef": "off",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      // Allow `_`-prefixed identifiers to mark intentionally-unused
      // destructure discards (e.g. `const { clientId: _clientId, ...rest } = d`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // react-doctor: only meaningful in the React app, so scope to apps/web.
  // Globally disable rules that don't apply to a Vite SPA.
  {
    ...reactDoctor.configs.recommended,
    files: ["apps/web/src/**/*.{ts,tsx}"],
  },
  {
    ...reactDoctor.configs["tanstack-query"],
    files: ["apps/web/src/**/*.{ts,tsx}"],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      // Vite SPA — there is no SSR. `new Date()` reachable from JSX cannot
      // mismatch between server and client because the server doesn't render.
      "react-doctor/rendering-hydration-mismatch-time": "off",
      "react-doctor/rendering-hydration-no-flicker": "off",
      // Vite SPA — no server actions / progressive enhancement story. Forms
      // rely on `e.preventDefault()` + a mutation; that's the correct pattern.
      "react-doctor/no-prevent-default": "off",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/__generated__/**",
      "**/*.config.*",
      "**/*.gen.d.ts",
      // Plain ESM bootstrap files that aren't part of the TS project graph —
      // tsc doesn't compile them and the typed-eslint project service can't
      // load them, so skip linting entirely.
      "**/*.mjs",
    ],
  },
);
