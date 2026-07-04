# Decision 053: Prerendering Fixtures and Calendar Months via Hash-Diffed Manifest

**Date:** 2026-07-04
**Status:** Accepted

## Decision

Game pages (`/calendar/game/:id`, current season only) and calendar month pages (`/calendar/:year/:month`, previous + current year) join the publish-time prerender pipeline from ADR 052. A second manifest endpoint, `GET /api/games/prerender-manifest`, lives in the games feature and is merged with the content manifest by the prerenderer Lambda. Because game pages compose Play Cricket data with DB overlays that carry no usable update timestamps, these items diff on an opaque djb2 **content hash** of everything render-relevant (summary fields, sponsorships, matchday result and lineup, game report publish state) instead of timestamps alone. The CloudFront function's game OG-redirect becomes the KVS-miss fallback: a snapshot wins when present, and un-snapshotted games (past seasons, pre-first-render) keep today's redirect so link previews never regress.

## Problem

ADR 052 deliberately excluded game pages ("game reports keep their existing OG-redirect mechanism"). That left the club's most-shared pages - fixtures and results - with three costs: every visitor pays two redirects through the API OG page before the SPA even starts, meta is a generic "Match Result" line, and the calendar month grid is an empty shell on first paint with nothing for crawlers. Extending the pipeline hit two structural obstacles:

1. **No diffable timestamps.** The content manifest re-renders on `updated_at` changes; `match_result` has only `created_at`, sponsorship approval flips a boolean, matchday results and lineups live across two tables, and Play Cricket's own `last_updated` is date-precision only.
2. **Redirect ordering.** The CloudFront function 302s every `/calendar/game/:id` to the API OG page _before_ the KVS lookup (a test pinned that precedence), so a snapshot would never be served.

## Options considered

1. **Separate games manifest with content hashes (chosen).** New endpoint in the games feature; Lambda merges both manifests; reconcile compares an optional `hash` field alongside timestamps.
2. **Extend the content manifest enum with games.** Push game rows through `listPrerenderManifest`.
3. **Add `updated_at` columns everywhere.** Migrate `match_result` (and touch sponsorship/matchday write paths) so timestamp diffing works for games too.
4. **Time-based re-rendering.** Re-render all game pages on every 15-minute sweep, no diffing.

## Rationale

- Games live in Play Cricket plus four DB tables, not the `content` table; forcing them through the content manifest would tangle a clean query path with a PC API client it doesn't otherwise need. A sibling endpoint keeps each feature self-contained and lets the Lambda treat "games manifest 404" as "feature off" (no PC creds) while any other failure aborts the sync - so a PC outage can never read as "all games vanished" and mass-unrender snapshots.
- The hash approach needs no migrations and catches every render-relevant change in one mechanism, including ones timestamps can't express (a sponsorship approval, a lineup swap, a game report crossing its scheduled publish time). A false hash collision self-heals on the next forced render-all; a missed change self-heals visually because the SPA refetches over every snapshot.
- Scope (current season's ~100-130 games + 24 months) keeps a full render-all inside a 900s Lambda timeout; each game render costs a live PC detail call. The sync now flushes KVS routing, state and invalidations every 25 documents, so a timeout resumes from the last flush instead of never converging. Older seasons keep the OG-redirect fallback, which stays correct indefinitely.
- Results appear via the Play Cricket sync (a separate ECS task), which now pings the prerenderer on exit; sponsorship approval/payment and matchday finish/cancel fire the same fire-and-forget reconcile as content mutations. The 15-minute sweep remains the backstop for everything else (including PC-side edits, caught by the hash).

## Rejected alternatives

- **Extending the content manifest enum**: couples the content feature to the Play Cricket client and gives games slug/published_at semantics they don't have. Becomes attractive only if games ever move into the content table.
- **Adding `updated_at` columns**: a migration plus discipline across every write path (including the sync's upserts), and still blind to changes in Play Cricket's own data that never touch our DB. Reconsider if hash computation ever becomes a hot path.
- **Time-based re-rendering**: ~130 PC detail calls every 15 minutes forever, against a free-tier-conscious budget, to avoid a diff that costs two summary calls and a handful of batch queries. No.
- **All seasons (2015+, ~1300 pages)**: exceeds the Lambda ceiling on every deploy's render-all and hammers the PC API. Reconsider with a chunked/self-invoking render orchestration if historical SEO ever matters; the OG-redirect fallback covers link previews there meanwhile.

## Operational notes

- Month pages hash the month's game subset plus ALL published events (every month snapshot embeds the full dehydrated events list), so one event edit re-renders 24 month pages - cheap and correct.
- `/calendar` itself stays SPA: it is a client-side redirect to the current month.
- Play Cricket's `last_updated` is date-precision; a same-day scorecard correction that changes no DB overlay may not flip the hash until the next day. Harmless: the Scorecard component fetches live and the SPA refetches the seeded game query over the snapshot.
- Rollback: revert the CloudFront function (or delete the game/month KVS keys) and the OG redirect returns instantly; snapshots in S3 are inert.
