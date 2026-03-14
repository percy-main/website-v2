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

## Low Priority

### `scoring_threshold` chaos rule guard is semantically wrong

**Location:** `apps/api/src/features/fantasy/calculate-scores.ts` (line 662)

The `battingPts > 0` guard before the threshold check is a short-circuit optimisation that is semantically incorrect for edge cases (e.g. `min_runs = 0`). In practice the guard produces correct results because the inner `some()` check would also return false, but it masks intent.

**Fix:** Remove the `battingPts > 0` and `bowlingPts > 0` guards — always run the `some()` check when the chaos rule is active.
