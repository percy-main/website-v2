import eslint from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import hooksPlugin from "eslint-plugin-react-hooks";
import reactDoctor from "react-doctor/eslint-plugin";
import tseslint from "typescript-eslint";

// Project-wide policy: every ESLint rule is "error" or "off" — never "warn".
// Warnings just turn into noise that doesn't block CI. This helper takes a
// rules object from a shared preset and promotes every "warn" to "error" so
// new rules added by future plugin upgrades surface as failures by default.
function warnsToErrors(rules) {
  const out = {};
  for (const [name, value] of Object.entries(rules)) {
    if (value === "warn") {
      out[name] = "error";
    } else if (Array.isArray(value) && value[0] === "warn") {
      out[name] = ["error", ...value.slice(1)];
    } else {
      out[name] = value;
    }
  }
  return out;
}

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: {
      "react-hooks": hooksPlugin,
    },
    rules: warnsToErrors(hooksPlugin.configs.recommended.rules),
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
  // ruleset replaces the legacy "exhaustive-deps as error" stance. Every
  // warn-level rule is promoted to error per the no-warnings policy.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": hooksPlugin,
    },
    rules: warnsToErrors(hooksPlugin.configs["recommended-latest"].rules),
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
    rules: warnsToErrors(reactDoctor.configs.recommended.rules),
  },
  {
    ...reactDoctor.configs["tanstack-query"],
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: warnsToErrors(reactDoctor.configs["tanstack-query"].rules),
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
    },
    rules: {
      // Vite SPA — there is no SSR. `new Date()` reachable from JSX cannot
      // mismatch between server and client because the server doesn't render.
      "react-doctor/rendering-hydration-mismatch-time": "off",
      "react-doctor/rendering-hydration-no-flicker": "off",
      // Vite SPA — no server actions / progressive enhancement story. Forms
      // rely on `e.preventDefault()` + a mutation; that's the correct pattern.
      "react-doctor/no-prevent-default": "off",
      // dangerouslySetInnerHTML is the XSS landmine — block it at the lint
      // gate instead of only surfacing it as a warn-level CLI finding in the
      // react-doctor PR comment.
      "react/no-danger": "error",
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
