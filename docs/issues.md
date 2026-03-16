# Known Issues

Issues discovered during migration that need fixing. Organised by priority.

---

## High Priority

### PostgreSQL aggregate results used as numbers without `Number()` wrapping

**Location:** `apps/api/src/features/fantasy/service.ts` (lines 72, 143, 32, 56)

`count(*)` and `sum()` return strings in node-pg. The `sql<number>` annotation is a TypeScript-only assertion — at runtime the values are strings. Works by accident due to JS coercion but violates the CLAUDE.md guideline and will break strict equality checks (`"3" === 3` is `false`).

Affected calls:

- `totalTeams` in `getEligiblePlayers` — used in division for `ownershipPercent`
- `transfersUsed` in `getMyTeam` — returned to frontend, compared to `MAX_TRANSFERS_PER_GAMEWEEK`
- `sum(total_points)` and `count(distinct ...)` in `getEligiblePlayers`

**Fix:** Wrap each aggregate result in `Number()` at the point of use.

---

### Fielding upsert in sync is cumulative, not idempotent

**Location:** `apps/api/src/features/play-cricket/sync.ts` (lines 326–329)

The `onConflict` handler for `match_performance_fielding` uses additive SQL:

```typescript
catches: sql`match_performance_fielding.catches + excluded.catches`;
```

Batting and bowling upserts use simple value replacement (idempotent). If a match is partially processed (batting stored, crash before `match_result` written), a re-run will double-count fielding stats.

**Fix:** Either use `doUpdateSet` with raw values like batting/bowling, or delete existing fielding rows before reinserting.

---

### `saveTeam` allows duplicate player IDs

**Location:** `apps/api/src/features/fantasy/service.ts`, `saveTeam` function

No uniqueness check on `playCricketId` in the squad submission. Submitting the same player twice would create duplicate `fantasy_team_player` rows, double-counting their points in team score calculation and under-charging the budget.

**Fix:** Add a uniqueness check after parsing:

```typescript
const uniqueIds = new Set(players.map((p) => p.playCricketId));
if (uniqueIds.size !== players.length) {
  throw Object.assign(new Error("Duplicate players are not allowed"), {
    statusCode: 400,
  });
}
```

---

## Medium Priority

### Auth route guards return `null` during session loading, causing layout flash

**Location:** `apps/web/src/components/require-auth.tsx`, `require-verified-email.tsx`, `require-role.tsx`

`RequireAuth`, `RequireVerifiedEmail`, and `RequireRole` all return `null` while the session is loading (`isPending`). Since these components sit inside `RootLayout`, the header and footer remain visible but `<main>` goes blank momentarily before the protected content appears. This causes a visible flash on every navigation to an authenticated route.

**Fix:** Return a loading skeleton or spinner instead of `null`. Consider a shared `<PageLoading />` component that all guards use for consistency. Worth doing as part of a broader loading/suspense strategy when porting more protected pages.

---

### Mobile drawer lacks keyboard trap

**Location:** `apps/web/src/components/site-header.tsx` (mobile drawer)

The drawer has `role="dialog"`, `aria-modal`, `aria-label`, and focus-on-open, but does not trap keyboard focus within the drawer. A user pressing Tab can move focus behind the overlay to page content. Full WCAG 2.1 compliance requires a focus trap (e.g. looping focus between the first and last focusable elements inside the drawer).

**Fix:** Add a focus trap — either manually with `onKeyDown` Tab handling, or use a library like `focus-trap-react`.

---

## Low Priority

### `scoring_threshold` chaos rule guard is semantically wrong

**Location:** `apps/api/src/features/fantasy/calculate-scores.ts` (line 662)

The `battingPts > 0` guard before the threshold check is a short-circuit optimisation that is semantically incorrect for edge cases (e.g. `min_runs = 0`). In practice the guard produces correct results because the inner `some()` check would also return false, but it masks intent.

**Fix:** Remove the `battingPts > 0` and `bowlingPts > 0` guards — always run the `some()` check when the chaos rule is active.
