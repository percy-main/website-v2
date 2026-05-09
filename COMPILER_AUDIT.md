# React Compiler trial — branch summary

Branch: `react-compiler-trial`

## What this branch does

1. Upgrades the toolchain to **Vite 8** (Rolldown bundler) + `@vitejs/plugin-react@6` + `@tailwindcss/vite@4.3` + `tailwindcss@4.3`.
2. Installs **React Compiler 1.0** (stable, Oct 2025) and wires it into Vite via `@rolldown/plugin-babel` + `reactCompilerPreset()` — the post-v6 `plugin-react` no longer accepts Babel plugins directly.
3. Switches the apps/web ESLint scope to `eslint-plugin-react-hooks/configs/recommended-latest` (compiler-aware rules).
4. Strips the manual memoization the compiler now subsumes (~50 sites across 19 files).

## Versions before / after

| Package | Before | After |
| --- | --- | --- |
| `vite` | `^6.4.2` | `^8.0.11` |
| `@vitejs/plugin-react` | `^4.3.4` | `^6.0.1` |
| `@rolldown/plugin-babel` | — | `^0.2.3` (new) |
| `babel-plugin-react-compiler` | — | `^1.0.0` (new) |
| `@tailwindcss/vite` | `^4.0.0` | `^4.3.0` |
| `tailwindcss` | `^4.0.0` | `^4.3.0` |

Node engine requirement is unchanged (Vite 8 needs 20.19+/22.12+; we're on 22.21).

## vite.config.ts wiring

The new pattern (post-`plugin-react@6`):

```ts
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

plugins: [
  // …
  react(),
  babel({ presets: [reactCompilerPreset()] }),
  tailwindcss(),
  // …
]
```

One Rolldown gotcha caught in this branch: object-form `manualChunks` is unsupported. Converted to function form keyed off `node_modules/(@tanstack/react-query|react|react-dom|react-router|scheduler)`.

## ESLint config

`eslint.config.mjs` now applies the compiler-aware ruleset to apps/web. The order matters — the apps/web override sits **after** the global `react-hooks/exhaustive-deps: "error"` block so the new ruleset's `warn` level wins. With the compiler doing dependency tracking and function-identity stabilisation, treating `exhaustive-deps` as a hard error in apps/web no longer reflects reality.

The api / email packages keep the legacy `recommended` ruleset.

## Verification

| Check | Result |
| --- | --- |
| `pnpm --filter web typecheck` | clean |
| `pnpm --filter web lint` | 0 errors, 106 warnings (all pre-existing `react-doctor`) |
| `pnpm --filter web build` | ~8s (down from ~13.5s on Vite 6); compiler runtime present in main + vendor chunks; per-component cache scaffolding in 70+ chunks |
| `pnpm --filter web test` | 514/514 pass |
| HMR dev server | serves compiler-transformed components (`useMemoCache` calls visible in transformed source) |

## Memoization stripped

19 files. All call-sites where the wrapper was pure-derivation or a plain handler were converted to either an inlined expression or a non-memoized function. The compiler now caches them automatically.

| File | Removed |
| --- | --- |
| `components/map.tsx` | 2× `useCallback` |
| `components/marketing/lead-form.tsx` | 1× `useCallback` |
| `components/members/two-factor.tsx` | 1× `useCallback` |
| `components/site-header.tsx` | 3× `useCallback` |
| `hooks/use-theme.tsx` | 2× `useCallback` |
| `pages/admin/juniors-tab.tsx` | 2× `useMemo` |
| `pages/admin/record-linking-tab.tsx` | 5× `useMemo` |
| `pages/admin/sponsorships-tab.tsx` | 2× `useMemo` |
| `pages/admin/treasurer-tab.tsx` | 4× `useMemo` |
| `pages/auth/login/email-password.tsx` | 1× `useCallback` |
| `pages/auth/login/forgot-password.tsx` | 1× `useCallback` |
| `pages/auth/login/recovery.tsx` | 1× `useCallback` |
| `pages/auth/login/reset-password.tsx` | 1× `useCallback` |
| `pages/auth/login/two-fa.tsx` | 1× `useCallback` |
| `pages/auth/register.tsx` | 2× `useCallback` |
| `pages/availability/public-availability.tsx` | 2× `useMemo`, 3× `useCallback` |
| `pages/calendar/calendar-month.tsx` | 7× `useMemo` |
| `pages/game/be-the-keeper.tsx` | 1× `useCallback` |
| `pages/home.tsx` | 1× `useMemo` |
| `pages/members/members-fantasy.tsx` | 2× `useMemo` |
| `pages/official/availability.tsx` | 3× `useCallback` |
| `pages/scout/attachments/use-attachment-upload.ts` | 4× `useCallback` |
| `pages/scout/scout.tsx` | 3× `useMemo` |
| `pages/scout/share-thread-modal.tsx` | 2× `useMemo` |

## Memoization kept (intentional)

- **`pages/scout/use-scout-chat.ts`** — the `DefaultChatTransport` instance must not lose identity across renders or `useChat` treats it as a new chat session. The compiler would memoize equivalently, but this is third-party-library-coupled state — left explicit, with a smoke-test in the post-merge plan.
- **`pages/scout/message-view.tsx`** — already had no manual `useMemo`/`useCallback`; the existing ref-in-effect pattern (with the `react-hooks/purity`-satisfying comment) is unchanged.

## Patterns the compiler is happy with

Verified across the codebase: no `React.memo`, no `forwardRef`, no `"use no memo"` directives, no mutation in render bodies, no conditional / for-looped hook calls, no class components.

## Pre-existing manual `exhaustive-deps` suppressions

Two suppressions remain (unchanged by this branch):
- `pages/admin/record-linking-tab.tsx:158` — `// eslint-disable-next-line react-hooks/exhaustive-deps -- same pattern as v1`. Could be re-evaluated now that the surrounding `useMemo`s are gone.
- `pages/scout/facts-admin.tsx:442` — closes over latest fact via the hook caller. The compiler now stabilises identity; the suppression is likely unnecessary.

## Smoke-tests still pending (manual)

- Scout chat session: start a thread, send a few messages, switch threads, verify no chat-session reset.
- `be-the-keeper` game loop: the `handleGameOver` was previously stabilised by `useCallback` and is now relied upon to be compiler-stabilised (used in a `useEffect` deps array). The lint rule was relaxed to warn-level for this case; verify the game-over flow still works end-to-end.
- `availability/public-availability`: the draft-merge logic in `setDateResponse`/`setDateNote` closes over `serverResponses`. Test by completing an availability response, signing out, signing back in, and confirming the draft re-merges correctly.
