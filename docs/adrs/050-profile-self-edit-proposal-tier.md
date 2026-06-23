# Decision 050: Profile Self-Editing via a Proposal/Approval Tier

**Date:** 2026-06-23
**Status:** Accepted

## Decision

Members may edit their own person profile, but their edits do **not** publish
directly. A slug-linked member submits a **proposal** (a `content_proposal`
row) carrying only the self-editable slice of their profile - the bio (body)
and the photo. The proposal is invisible to the public and to the live profile
until a `content_people:publish` editor **approves** it, at which point it
wholesale-replaces the live profile's body/metadata and writes a
`content_revision` exactly like any other save. Editors may instead **reject**
it with an optional note. This is the first use of the review tier the content
permission model deliberately reserved (#479) by keeping `manage` and `publish`
distinct on the content resources.

Eligibility is derived, not granted: a member is eligible iff their `member`
row is slug-linked to a person `content_item` (`member.slug = content_item.slug`
where `kind = 'person'`). That link already exists and is set by an admin in
the Record Linking tab. No new link table, opt-in flag, or role is introduced.

## Problem

Issue #575 wants members to keep their own profiles current without giving them
access to the admin content editor. Two properties are non-negotiable:

1. **A profile is safeguarding-adjacent.** `isDBSChecked` and `hasLeftClub` are
   public flags parents rely on, and the display name (title) and slug feed the
   public roster and URLs. A member must never be able to change those, only
   their bio and photo.
2. **Edits must be reviewed before going live.** The existing publish path is
   direct (single body, no staged drafts), so letting members write to it would
   put unreviewed text on a public profile instantly.

## Options considered

### Proposal table + approval tier (chosen)

A dedicated `content_proposal` table stores the proposed body + a photo-only
metadata subset, with a `pending/approved/rejected` status and reviewer
columns (mirroring the `matchday_expense` approval precedent). A partial unique
index enforces one pending proposal per profile. Approval merges only the photo
onto the live metadata, leaving the safeguarding flags untouched, and snapshots
a revision through the shared `writeRevision` helper.

- **The field subset is enforced structurally, not by trust.** The submit
  schema accepts only `{ body, photo }`; title/slug/flags cannot be expressed,
  so even a hand-crafted request cannot touch them. Approval re-derives the new
  metadata from the live row's flags, never from the proposal.
- **Review is a first-class state, not a flag bolted onto the live row.** The
  live profile is never in a half-edited state; a pending proposal sits beside
  it and either replaces it atomically or is discarded.
- **Reuses everything.** Eligibility falls out of the existing member↔slug
  link; approval reuses the content service's revision snapshotting; the
  reviewer pool is resolved with the same `checkPermission`-over-elevated-users
  pattern as the Scout share list.

### Direct write to the live profile, gated by a new self-edit permission (rejected)

Give eligible members a narrow write to their own `content_item` body/photo.

Rejected: it violates property 2 (edits go live unreviewed), and a per-row
ownership check on the live table is easy to get subtly wrong in a way that
exposes the safeguarding flags or another member's row. The whole point of
#575's brief was that changes "must be approved by a content editor before
going live."

### A new link table mapping users to editable profiles (rejected)

The original triage assumed the user↔profile link did not exist.

Rejected: it already does (`user` → `member` by email → `member.slug` → person
`content_item`). A second mapping would be a redundant source of truth that
could drift from the Record Linking tab.

## Rationale

The permission model already carved out `manage` vs `publish` on
`content_people` precisely so a review tier could be added "without a data
migration" to the permissions. #575 is that tier, so the approver gate is the
existing `content_people:publish` action - no new role. The proposal table is
the only new storage, and it is additive.

Concurrency and safety choices, explicitly:

- **One open proposal per profile.** A partial unique index
  (`status = 'pending'`) is the backstop; the service raises a friendly 409
  before hitting it. Approved/rejected rows are historical and excluded, so a
  member can submit again once their last proposal is resolved.
- **Approve/reject flip the status with a guarded `WHERE status = 'pending'`
  UPDATE inside the transaction**, so two editors racing the same proposal
  resolve to one winner and a 409 for the loser - the same pattern as the
  content publish path.
- **Notifications are best-effort.** On submit, every `content_people:publish`
  editor except the proposer is emailed; on decision, the proposer is emailed
  (rejections carry the note). A mail failure is logged and never rolls back
  the committed proposal/decision, matching the matchday and financial-relief
  notifiers.
- **Photo removal is expressible** (`photo: null`) because the owner controls
  their own photo; the safeguarding flags are simply never part of the
  proposal payload.

## Rejected alternatives

- **Direct gated write to the live profile** - rejected: unreviewed edits go
  live, contradicting the issue's core requirement.
- **A user→profile link table** - rejected: duplicates the existing
  member-slug link and invites drift.
- **A generic content-approval workflow across all kinds** - deferred: only
  person self-editing needs review today. The `content_proposal` table is
  scoped to that; generalising it (other kinds, multi-field proposals) can
  build on the same shape if a need appears, without retrofitting it now.
