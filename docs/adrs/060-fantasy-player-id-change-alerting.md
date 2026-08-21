# Decision 060: Alert on Play Cricket player ID changes, reconcile them by hand

**Date:** 2026-08-21
**Status:** Accepted

## Decision

The scheduled Play Cricket sync compares the club's current Play Cricket
members list against `fantasy_player` and posts a Slack alert when an ID that
fantasy still depends on stops being returned. It does nothing else: no admin
UI, no merge endpoint, no automatic repointing of rows. Repairing a confirmed
ID change stays a manual database job.

A player is only worth alerting about when they are `eligible` or already
referenced by `fantasy_team_player`. Candidate replacements are found by exact
match on a normalised name (trim, case-fold, collapse whitespace) against
member IDs that `fantasy_player` has never seen.

## Problem

In July 2026 Play Cricket reassigned a player's member ID mid-season. The
player sync upserts every member ID the API returns, so the new ID arrived as
a second `fantasy_player` row while every existing pick stayed on the old one.
Scores are joined on `play_cricket_id`, so two fantasy teams silently earned
zero points from that player for the rest of the season. Nothing surfaced it -
no error, no empty result, no failed sync - and it was only noticed weeks
later when a manager queried their total. The repair was a handful of UPDATE
statements and a score recalculation.

## Options considered

1. **Detect and alert only (chosen).** Run the comparison inside the scheduled
   sync and post the suspected pairs to Slack. A human confirms against Play
   Cricket and repoints the rows.

2. **Detect, alert, and ship an admin merge tool.** The original proposal on
   #596: a "possible ID changes" panel in the fantasy admin tab plus a
   `mergeFantasyPlayers` transaction repointing `fantasy_team_player`,
   `fantasy_player_score`, the three `match_performance_*` tables,
   `member.play_cricket_id`, `dependent.play_cricket_id`, and
   `rv_player_mapping.pc_player_id`.

3. **Merge automatically on a confident name match.** No human in the loop at
   all.

## Rationale

The expensive half of this incident was the silence, not the repair. Detection
is a comparison over two small tables and one API response the sync already
has a client for; the repair is a rare, ten-minute manual job. Building the
merge tool means a transaction across seven tables with a conflict path on
`fantasy_player_score`'s unique key, a confirmation UI, and its own integration
tests - a substantial surface to own and keep correct for something that has
happened once. Alerting closes the whole gap that actually cost anyone points,
and if the frequency ever justifies automation the detection service is the
input that tool would need anyway.

Name matching is exact-on-normalised only. Fuzzy matching would convert a rare,
high-signal alert into a recurring trickle of near-misses, and the alert's
whole value is that receiving one means something is genuinely wrong. The
incident case matched exactly.

Alerting is deliberately best-effort: a detection or Slack failure is logged
but never added to the sync's error list, because that list drives the ECS
task's exit code. A missing webhook must not turn a successful data sync into
a failed scheduled task. A hit is logged before the Slack call is attempted,
so the finding still reaches New Relic when the webhook is unset or down.

## Rejected alternatives

- **Admin merge tool (option 2):** rejected as disproportionate for a
  once-a-season event, per the reduced scope agreed on #596. Worth revisiting
  if this fires more than once or twice a season, or if a repair is ever
  needed by someone without database access.
- **Automatic merge (option 3):** rejected outright. Two genuinely distinct
  members can share a name at a club this size, and an incorrect merge
  silently rewrites historical scorecards across the `match_performance_*`
  tables - strictly worse than the bug it fixes, and much harder to undo.

## Limitations

Detection cannot distinguish an ID change from an ordinary departure, so a
player who is eligible or picked and simply leaves the club will be flagged,
with no candidate, on every sync run until someone marks them ineligible or
the season's picks age out. There is no alert-state table, so nothing
de-duplicates repeat alerts between runs. An empty members list from the API
is treated as no data rather than as every member vanishing, which is what
keeps a Play Cricket outage from flagging the entire squad.
