import eslint from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactDoctor from "eslint-plugin-react-doctor";
import hooksPlugin from "eslint-plugin-react-hooks";
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
    // Same no-warnings policy applies to ESLint's own meta-rules: an
    // unused `eslint-disable` is dead code that drifts as the codebase
    // changes, so block CI on it rather than letting it rot in place.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
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
      "no-warning-comments": [
        "error",
        { terms: ["todo"], location: "anywhere" },
      ],
    },
  },
  // apps/web runs the React Compiler — recommended-latest's compiler-aware
  // ruleset replaces the legacy "exhaustive-deps as error" stance. Every
  // warn-level rule is promoted to error per the no-warnings policy.
  {
    files: ["apps/{web,matchday}/src/**/*.{ts,tsx}"],
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
  // Vitest asserts on mock method references (`expect(mock.write)`), which
  // never rebind `this` — typescript-eslint 8.65 tightened unbound-method
  // to flag them. Off for tests only; production code keeps the rule.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  // react-doctor full ruleset is scoped to apps/web — it's a maturity
  // ratchet aimed at the long-established main site. apps/matchday is
  // fresh code under heavy iteration; rather than fight every stylistic
  // rule during phase 3, we apply only the correctness-critical rules
  // (set-state-in-effect, no-danger, no-deprecated-apis) and let the
  // rest tighten in follow-ups.
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

      // -------------------------------------------------------------------
      // Rules newly surfaced by the eslint-plugin-react-doctor 0.2.1 -> 0.2.16
      // bump (#419). The bump tightened/added ~18 rules that flag ~111 spots
      // in the long-established apps/web code. They are deliberately turned
      // OFF here and scheduled to be re-enabled and fixed incrementally
      // (each its own small, reviewable follow-up) rather than fixed in one
      // large behaviour-changing sweep while the rules are unreviewed. See
      // the #419 PR for the per-rule fix recommendations.
      // -------------------------------------------------------------------

      // Behavioural / React-state rules - fixing these changes runtime
      // behaviour, so each needs per-site review before turning back on:
      "react-doctor/react-compiler-no-manual-memoization": "off", // 14 sites; remove manual memo under React Compiler
      "react-doctor/exhaustive-deps": "off", // overlaps react-hooks/exhaustive-deps (already on); dep edits are behavioural
      "react-doctor/no-chain-state-updates": "off",
      "react-doctor/no-adjust-state-on-prop-change": "off",
      "react-doctor/no-derived-state": "off",
      "react-doctor/no-initialize-state": "off",
      "react-doctor/no-effect-with-fresh-deps": "off",
      "react-doctor/rerender-lazy-ref-init": "off",
      "react-doctor/jsx-no-constructed-context-values": "off",

      // Structure / file-organisation rules - pure churn (would split many
      // files), no runtime effect:
      "react-doctor/only-export-components": "off", // 18 sites
      "react-doctor/no-multi-comp": "off",
      "react-doctor/prefer-module-scope-static-value": "off",
      "react-doctor/prefer-module-scope-pure-function": "off",

      // a11y / markup rules - genuinely worth re-enabling and fixing;
      // deferred only to keep this bump reviewable. iframe-missing-sandbox is
      // security-relevant and should be the first re-enabled (with a tested
      // sandbox attribute):
      "react-doctor/iframe-missing-sandbox": "off", // 2 sites - SECURITY, re-enable first
      "react-doctor/control-has-associated-label": "off", // 16 sites
      "react-doctor/button-has-type": "off", // 20 sites
      "react-doctor/prefer-tag-over-role": "off",
      "react-doctor/prefer-html-dialog": "off",
    },
  },
  // Matchday: subset of react-doctor — just the correctness rules.
  // set-state-in-effect comes from react-hooks/recommended-latest
  // (applied globally above) so doesn't need re-declaring here.
  {
    files: ["apps/matchday/src/**/*.{ts,tsx}"],
    plugins: {
      "react-doctor": reactDoctor,
      react: reactPlugin,
    },
    rules: {
      "react-doctor/no-react19-deprecated-apis": "error",
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
