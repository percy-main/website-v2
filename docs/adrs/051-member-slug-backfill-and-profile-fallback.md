# Decision 051: Member Slug Backfill, Member-Backed Profile Fallback, and Self-Create on First Edit

**Date:** 2026-06-24
**Status:** Accepted

## Decision

Three coupled changes make a profile slug the default for every member, so
self-editing (ADR 050) and public profile links are available to all members
rather than only the handful an admin had hand-linked:

1. **Backfill `member.slug` for every member** (a one-off data migration). The
   slug is derived from the member's name, with numeric suffixes resolving
   collisions. The "used" set is seeded with both existing member slugs and all
   existing person `content_item` slugs, so a backfilled slug never collides
   with - and so never accidentally links to - an unrelated person's page.
2. **Serve a member-backed stub profile** when `GET /content/person/:slug`
   finds no published page but a live member owns the slug. The stub is the
   member's name plus the slug-keyed stats/sponsor panels - no bio. It runs
   only after the tombstone check, so a taken-down profile is never resurrected.
3. **Let self-edit create the profile page.** A slug-linked member with no
   `content_item` yet gets a "virtual" editable profile. Their first submitted
   proposal creates the person item as a **draft**; approval **publishes** it.
   This extends ADR 050's edit-only flow to also cover first creation.

## Problem

ADR 050 made a member's profile self-editable, but only when their `member` row
was slug-linked to an existing published person `content_item`. In practice
almost no members were linked (links were set one at a time in the Record
Linking tab), and most members have no profile page at all. Two goals follow:

- **Every member should be able to maintain a profile**, which requires the
  slug link (the self-edit precondition) to exist for everyone.
- **Leaderboard/records/scorecard rows should link to profiles.** Those links
  are emitted whenever `member.slug` is non-null, so backfilling slugs turns
  every player's name into a profile link.

The risk a broad backfill introduces: a slug link is necessary but **not
sufficient**. The public profile page (`/person/:slug`) renders only when a
**published** person `content_item` exists at that slug; otherwise the API 404s
and the SPA shows a "Person Not Found" dead-end. So backfilling slugs would,
before any page is authored, turn every leaderboard click into a dead-end, and
self-edit still would not work (it required the page to pre-exist).

## Options considered

### Member-backed fallback + self-create (chosen)

Backfill slugs, serve a stub from the member row when no page exists, and let
the first self-edit create the page.

- **No dead-ends.** A leaderboard click always lands on a real page: either the
  published profile, or a stub with the player's name and stats (the stats panel
  already resolves off `member.slug` + `play_cricket_id`, so the stub is the
  useful "stats, bio coming soon" state).
- **The link genuinely unlocks editing.** A member with a backfilled slug but no
  page can author their first bio; it lands as a draft and goes live through the
  same ADR 050 approval gate - content is still admin-reviewed before publishing.
- **Safeguarding is preserved.** The tombstone (410) check precedes the stub, so
  a deliberately unpublished/archived profile is never re-exposed as a stub.
  Approval promotes only a **never-published** draft (status `draft` **and** no
  past `published_at`) - exactly the create-on-first-edit case. An unpublished
  or archived profile retains its `published_at`, so an approved edit updates
  its body but never republishes it; a takedown sticks. Soft-deleted members
  get no stub (404).

### Gate leaderboard links on page existence (rejected)

Only emit `/person/:slug` links when a published page exists.

Rejected as the primary fix: it removes the 404 but leaves players with no
landing page (their name stays plain text until someone authors a page), and it
does nothing for the "let everyone self-edit" goal. It is a strictly smaller
outcome than the stub, which already turns the link into a useful page.

### Auto-create a published page for every member (rejected)

Backfill slugs and also mint a published, empty person page per member.

Rejected: it manufactures hundreds of empty public pages (and an unreviewed
public surface) where the stub is a zero-storage, always-current stand-in that
disappears the moment a real page is published.

## Rationale and scope notes

- **Scope: all members.** Per the product owner, junior members who hold their
  own account are 13+, and all profile content is admin-approved before going
  live, so no age carve-out is applied. Dependents (juniors held under a parent
  member) have no `slug` column and are structurally untouched; the leaderboards
  only join `member`, so dependents are never linked either.
- **Stub exposure is bounded.** The `/people` directory lists published person
  items, not member stubs, so a stub is reachable only via a leaderboard link
  (cricket players) or by guessing the URL - it does not broadly publish every
  member's name in a listing. Names of players already appear on leaderboards.
- **Collision strategy avoids mis-linking over reuse.** A member who genuinely
  owns an existing person page but was never linked gets a fresh suffixed slug
  rather than being auto-attached to that page; an admin can re-link them in the
  Record Linking tab. Never wrong-linking (which would let one member edit
  another's profile) is the safer default.
- **Short 404 window is acceptable.** The migration (which makes slugs, and thus
  leaderboard links, appear) and the deploy carrying the fallback land together
  on `main`; any gap between them is brief and tolerable.
- **The stub is intentionally not cache-stable** (its timestamps are "now"): it
  is transient and vanishes once a real page is published, so a fresh ETag per
  request is fine.

## Rejected alternatives

- **Gate leaderboard links on page existence** - rejected as primary: removes
  the 404 but provides no landing page and does not enable self-editing.
- **Auto-mint a published page per member** - rejected: creates hundreds of
  empty public pages where a zero-storage stub suffices.
- **Reuse an existing page's slug when names match during backfill** - rejected:
  name matching is unreliable and a wrong match cross-links two people; suffixing
  to a distinct slug and leaving re-linking to an admin is safer.
