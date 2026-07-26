# Decision 056: "Did not bat" rows stay in the batting table with a did_bat flag

**Date:** 2026-07-26
**Status:** Accepted

## Decision

Play Cricket scorecard entries whose `how_out` says the player never took
strike ("did not bat", "dnb", "absent") are stored in
`match_performance_batting` with `did_bat = false`, `times_out = 0`,
`not_out = false`. They function as the appearance record: a player in the
XI who never batted still played the match. Aggregations that count innings
or not-outs must filter `did_bat = true`; aggregations that count matches
played or appearances must not.

## Problem

The how_out format-mismatch fix (PR #652) surfaced a modelling question.
DNB rows had been stored as innings-with-a-dismissal (inflating innings and
deflating averages), so the obvious fix was to delete them and stop
inserting them. But they are the only per-match record that a player was in
the team, and two consumers legitimately need that:

- the fantasy team win bonus (a selected player who never batted was still
  in the winning XI)
- the "most career matches" record, which counts distinct matches from the
  batting table

Deleting DNB rows silently broke both.

## Options considered

1. **Delete DNB rows; stop inserting them.** Keeps the batting table pure
   ("every row is an innings") but destroys appearance data.
2. **A separate `match_appearance` table** fed from the match detail
   `players` array, backfilled from existing data. Semantically cleanest:
   performance tables stay pure, appearances are first-class.
3. **Keep DNB rows, flagged with a `did_bat` boolean** (chosen).

## Rationale

The Play Cricket `bat` array with its DNB entries _is_ the appearance
record, and it is provably complete across all 26 seasons of synced data
(2,626 DNB/absent rows). A separate table would duplicate exactly that
information, add a second sync path and backfill to maintain, and depend on
the `players` array being reliably populated for every match, which the
`bat` array has already proven. One boolean column plus three `where`
clauses (leaderboard, two profile aggregates) was the whole cost.

## Rejected alternatives

- **Deleting DNB rows** - breaks the fantasy win bonus and the career
  matches record, and forfeits appearance data we cannot cheaply
  reconstruct for past seasons once deleted.
- **`match_appearance` table** - right shape in the abstract, but pure
  duplication of data the batting table already carries, with more moving
  parts. Becomes attractive if we ever need appearance data the `bat` array
  does not carry (e.g. captaincy per match, substitute fielders), or if
  Play Cricket stops listing non-batters in the `bat` array.

## Consequences

- Any new query over `match_performance_batting` must decide explicitly
  whether it is counting innings (`did_bat = true`) or appearances (no
  filter). The column comment and this ADR are the reference.
- `not_out` is false on DNB rows: they are not innings, so they are neither
  out nor not out; only `did_bat = true` rows carry innings semantics.
