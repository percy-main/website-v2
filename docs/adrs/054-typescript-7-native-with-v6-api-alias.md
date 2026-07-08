# Decision 054: TypeScript 7 native compiler, with the v6 JS API aliased for tooling

**Date:** 2026-07-08
**Status:** Accepted

## Decision

Adopt TypeScript 7 (the Go-native compiler) for all type-checking and emit, while keeping the TypeScript 6 JavaScript API installed under the `typescript` package name for tools that consume the compiler API. Every workspace package declares the pair:

```json
"@typescript/native": "npm:typescript@^7.0.2",
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

`typescript@7` ships the native `tsc` binary, so `tsc` in every package script now runs the Go compiler. `@typescript/typescript6` is Microsoft's parallel-maintenance distribution of the v6 line with its binaries renamed (`tsc6`), so it can coexist without bin conflicts while still providing `lib/typescript.js` to anything that does `require("typescript")`.

## Problem

TypeScript 7.0 (released 2026-07-08) is roughly 5-10x faster than 6.x - measured here: `apps/web` typecheck 11.6s -> 2.1s, `apps/api` 10.5s -> 2.4s, whole-workspace `pnpm typecheck` 6.8s. But 7.0 ships **no stable programmatic JS API** (promised for 7.1), and this repo has five consumers of that API:

- `typescript-eslint` (peer range `>=4.8.4 <6.1.0` - explicitly excludes 7)
- `openapi-typescript` (generates the typed frontend clients)
- `prettier-plugin-organize-imports`
- `kysely-codegen` (via cosmiconfig's TS loader)
- `.github/scripts/check-unsafe-ddl.mjs` (migration AST walker)

Upgrading the `typescript` package to 7 outright would break all five. Staying on 6 forfeits the compile-speed gains on every CI run and local check.

## Options considered

1. **Chosen: dual install via npm aliases** - `tsc` is native v7; the `typescript` name resolves to Microsoft's `@typescript/typescript6` package (v6 API, `tsc6` bin). This is the migration path Microsoft's own 7.0 announcement recommends.
2. **Stay on TypeScript 6** until 7.1 ships a stable API and typescript-eslint supports it.
3. **Upgrade `typescript` to 7 for real** and drop/replace the API consumers (e.g. lint without type-aware rules).

## Rationale

TS 7's checker is a methodical port of 6.0 - type-checking semantics are identical, so checking with 7 while linting through the 6 API cannot disagree about what the code means. We verified this empirically: full typecheck, lint, unit tests, and OpenAPI generation all pass, and a byte-level diff of `tsc6` vs `tsc7` emit across all four emitting packages (`shared`, `db`, `email`, `api`) showed identical runtime JS except for alphabetised specifier order in the synthesised `react/jsx-runtime` import, plus benign `.d.ts` property-ordering and declaration-sourcemap encoding differences.

The speedup is not cosmetic: typecheck is the long pole in the lint/test/build CI gate and runs on every PR push, and `tsc -b` gates both Vite builds.

## Rejected alternatives

- **Stay on 6 until 7.1**: forfeits a 5x speedup for months for zero risk reduction - the alias setup runs the exact same v6 code for the tools that need it. Becomes moot (not attractive) once 7.1 lands.
- **Full upgrade, drop API consumers**: type-aware lint rules, generated API clients, and the unsafe-DDL CI check are load-bearing; losing them costs far more than the dual install's minor package.json noise.

## Unwind plan

This is deliberately temporary. When TypeScript 7.1 ships its stable API **and** typescript-eslint / openapi-typescript / prettier-plugin-organize-imports publish support for it, collapse the pair back to a single `"typescript": "^7.1.x"` dependency and delete this alias arrangement (supersede this ADR).
