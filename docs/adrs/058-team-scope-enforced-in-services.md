# Decision 058: Team scope enforced in services, juniors admin club-wide only

**Date:** 2026-08-21
**Status:** Accepted

## Decision

Roles documented as team-scoped are now enforced as team-scoped in the places that were only checking the generic permission:

- **Matchday expenses and game reports** filter and 404 by the caller's `team_official` assignments, in the service layer, the same way `listMatches` / `getMatch` already did.
- **Expense reimbursement** is club-wide only. A team-scoped `official` cannot pay a claim out, even one raised on their own team.
- **The admin Juniors tab is club-wide only.** `junior_manager` loses it entirely rather than getting a scoped version of it, because there is nothing in the schema to scope it by. Their per-team `/junior-manager` area is unaffected.

Route-level gates (`requireClubWidePermission`) express "this action has no per-team meaning". Service-level filters express "this action is per-team, show me mine". Nothing new was built for either: both mechanisms already existed and were simply not applied to these paths.

## Problem

`SCOPED_ROLES` (`official`, `junior_manager`) grant full `matchday` / `juniors` permissions, with the per-team restriction enforced separately by service-layer code against the `team_official` and `junior_team_manager` join tables. Several endpoints only ran `checkPermission` and then queried by ID with no scope filter at all, so the documented restriction did not exist there:

- any `matchday:manage` holder could list, approve, reject and reimburse **every** team's expense claims;
- game reports - which carry per-player charge amounts and expense totals - were unfiltered;
- a `junior_manager` could list **every** dependent in the club with guardian contact details, and link or unlink arbitrary dependent IDs.

The last one is the sharp end: a role handed out per junior team could enumerate every minor's PII in the club.

## Options considered

**A. Build the real juniors scoping model.** Add a dependent-to-junior-team association (migration, assignment UI, filtered queries), then scope the juniors endpoints by it the same way matchday is scoped by `team_official`.

**B. Make the juniors admin endpoints club-wide only.** Gate them on `hasClubWideAccess` so only `juniors_viewer` / `juniors_admin` / `admin` reach them, and remove the tab from scoped junior managers.

**C. Derive the association at query time** from `dependent.school_year` / `dependent.sex` against `junior_team.age_group` / `junior_team.sex`.

For reimbursement, the parallel question was whether a scoped official should be able to reimburse their own team's claims (team-scope filter, like approve/reject) or not at all (club-wide gate).

## Rationale

Option B, plus a club-wide gate on reimbursement.

There is no dependent-to-junior-team membership table today, so true scoping for juniors is not currently _expressible_ - option A is a feature, not a fix, and leaving the hole open while it is built is not acceptable for minors' PII. Option B closes it now with machinery that already exists, and costs a small number of `junior_manager` holders a tab they should arguably never have had. Their actual working surface, the per-team `/junior-manager` area backed by `junior_team_manager`, is untouched.

Reimbursement is a treasurer action: it records that money left the club's account. That is a whole-club financial fact, not a per-team one, and it is the point in the workflow where a self-approving official would be cashing their own claim. Gating it club-wide keeps approve/reject usefully delegated to team officials while keeping the payout with the treasurer.

Mutations by ID 404 rather than 403 on an out-of-scope target, matching `getMatch`'s existing "not found or access denied" behaviour, so an expense or report belonging to another team is indistinguishable from one that does not exist.

## Rejected alternatives

**A. Build the real juniors scoping model.** Rejected as the immediate fix only - it remains the right long-term answer. It becomes attractive as soon as junior managers actually need club-record access for their own teams (checking guardian contacts for their squad, say). Doing it needs a membership table, an assignment UI in the admin panel, and filtered queries; at that point the juniors endpoints move from `requireClubWidePermission` back to `requirePermission` plus a service-layer filter, exactly like matchday.

**C. Derive juniors scope from age group and sex.** Rejected: it encodes a guess about squad membership as an authorisation boundary. Age groups and teams do not line up cleanly (a player can play up, a team can span years, mixed teams exist), so the derivation would be wrong in both directions - silently hiding a manager's own players, and silently exposing children they have nothing to do with. An authorisation rule should be a fact someone recorded, not an inference.

**Team-scoping reimbursement instead of gating it.** Rejected per the above. If reimbursement is ever delegated to team budgets, the filter is the same one already applied to approve and reject.

## Follow-ups

`finance_admin` - the role a treasurer would most naturally hold - still cannot reimburse, because these routes gate on `matchday:manage` and always have. In practice today's treasurers hold the legacy kitchen-sink `admin` role, so nothing regressed, but if the reimburse gate should follow the finance resource rather than matchday, that is a deliberate change to make on its own.
