# Financial Relief — Implementation Plan

Percy Main currently has an informal escape hatch — setting `member.member_category = "bursary"` causes the matchday flow to skip charge generation at `apps/api/src/features/matchday/service.ts:761` and `:1086`. This works operationally but leaves no record of who was supported, for what, or at what value. That makes "we provided £4,000 of financial relief this year" impossible to produce, and it can't distinguish full vs partial relief, expiry, or membership vs match donations.

This plan formalises the workflow on top of the existing `charge` model: members submit a structured request → an admin decides → approved relief is recorded as a grant → future eligible **match-fee** charges are still generated at full value but immediately marked **relieved** with a `relieved_at / relieved_by / relieved_reason / relief_grant_id` audit set (matching the existing `deleted_at / deleted_by / deleted_reason` triplet). Relieved charges are not debt, do not surface as outstanding to the member, do not enter Stripe bundles, but **do** carry their `amount_pence` so totals are summable.

## Scope decisions (v1)

- **Match-fee relief is the v1 auto-forgiveness path.** Match charges are generated server-side after the matchday is confirmed; relief slots cleanly into that flow.
- **Membership relief is admin-applied, not auto-applied.** Real membership purchases go through Stripe checkout and arrive in the system as already-paid charge rows via the webhook (`apps/api/src/features/payments/webhook-service.ts`, charge `type IN ('membership','junior_membership','junior_registration')`). There is no pre-pay moment to intercept. For v1, an approved grant with `covers_membership` triggers an admin-side **"Apply membership relief"** action that creates a relieved charge of the appropriate amount **and** extends the member's `membership.paid_until` — the equivalent of a free renewal. The action is gated by `requireRole("admin")` and recorded as a relief event. Partial membership relief in v1 reduces this action to "admin creates a relieved charge for the waived portion only; member pays the rest through normal Stripe checkout"; admins are guided to record this via the existing `createCharge` + the new "Apply" action.
- **No retrospective refunds.** Already-paid charges are not refunded by the relief flow. If an admin needs to refund, that's a manual Stripe operation outside this feature.

## Product principles applied

- **Dignity / low friction**: short form, no uploads, no income disclosure, "Prefer not to say" available everywhere, helper copy borrowed verbatim from the brief.
- **Reuse existing patterns**: form via `react-hook-form` + Zod (as junior registration / incident report), admin tab as a new sub-tab under `/admin?section=finance`, audit columns on `charge` mirroring `deleted_at/by/reason`, `requireRole("admin")` middleware, React Query hooks, OpenAPI-generated client.
- **Smallest coherent slice**: one new feature folder, three new tables, four new columns on `charge`, one member page, one admin sub-tab, two emails. Defer CSV export, anonymised public reports, and refunds.
- **No new roles**: full application details restricted to existing `admin` role. Captains see a neutral `"waived"` charge status on the officials' matchday view — never the application text, the grant note, or the partial amount.

## Data model

### New migration: `2026-05-12T*-financial-relief.ts`

```sql
-- The application form, one row per submission.
CREATE TABLE financial_relief_request (
  id                          TEXT PRIMARY KEY,
  submitted_by_user_id        TEXT NOT NULL REFERENCES "user"(id),
  member_id                   TEXT NOT NULL REFERENCES member(id),
  status                      TEXT NOT NULL DEFAULT 'submitted',
    -- submitted | in_review | more_info_needed | approved | declined | withdrawn | expired
  requested_membership_full    BOOLEAN NOT NULL,
  requested_membership_partial BOOLEAN NOT NULL,
  requested_match_fees         BOOLEAN NOT NULL,
  partial_amount_pence         INTEGER,
  reason_category              TEXT,
  reason_text                  TEXT,                   -- capped at 2000 chars in Zod
  duration                     TEXT,
  duration_other_text          TEXT,
  contribution_ability         TEXT,
  contribution_amount_pence    INTEGER,
  volunteer_options            JSONB NOT NULL DEFAULT '[]',
  volunteer_notes              TEXT,
  contact_preference           TEXT NOT NULL,
  privacy_acknowledged_at      TIMESTAMPTZ NOT NULL,
  declaration_confirmed_at     TIMESTAMPTZ NOT NULL,
  withdrawn_at                 TIMESTAMPTZ,
  withdrawn_reason             TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX financial_relief_request_member_id_idx ON financial_relief_request(member_id);
-- Hard DB-level guarantee: one open request per member.
CREATE UNIQUE INDEX financial_relief_request_one_open_uidx
  ON financial_relief_request(member_id)
  WHERE status IN ('submitted','in_review','more_info_needed');

-- The grant produced when an admin approves a request. Declines are NEVER persisted
-- as grants — they live on the request row + an event. A request can be re-decided
-- (e.g. extended) by closing the old grant and opening a new one.
CREATE TABLE financial_relief_grant (
  id                          TEXT PRIMARY KEY,
  request_id                  TEXT NOT NULL REFERENCES financial_relief_request(id),
  member_id                   TEXT NOT NULL REFERENCES member(id),
  decision                    TEXT NOT NULL,            -- approved_full | approved_partial | approved_temporary
  covers_membership           BOOLEAN NOT NULL,
  covers_match_fees           BOOLEAN NOT NULL,
  membership_partial_pence    INTEGER,                  -- if set, member contributes this portion of membership; NULL = full membership relief
  effective_from              DATE NOT NULL,
  effective_to_exclusive      DATE,                     -- NULL = open-ended; otherwise grant inactive on this date
  admin_notes                 TEXT,                     -- private to admins, never returned to non-admin endpoints
  member_facing_note          TEXT,                     -- the only admin-authored text shown to the member
  decided_by                  TEXT NOT NULL REFERENCES "user"(id),
  decided_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at                   TIMESTAMPTZ,
  closed_by                   TEXT REFERENCES "user"(id),
  closed_reason               TEXT
);
-- Hard DB-level guarantee: one active grant per member.
CREATE UNIQUE INDEX financial_relief_grant_one_active_uidx
  ON financial_relief_grant(member_id) WHERE closed_at IS NULL;

-- Admin decision history / status transitions.
CREATE TABLE financial_relief_event (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES financial_relief_request(id),
  event_type    TEXT NOT NULL,
    -- status_changed | note_added | more_info_requested | grant_created | grant_closed
    -- | declined | withdrawn | membership_relief_applied
  from_status   TEXT,
  to_status     TEXT,
  note          TEXT,
  actor_user_id TEXT NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX financial_relief_event_request_id_idx ON financial_relief_event(request_id, created_at);

-- Relief columns on charge. Mirrors the deleted_at/by/reason triplet.
-- original_amount_pence is set ONLY on the partial-relief case, so that the
-- "value retained for reporting" invariant holds without sibling rows.
ALTER TABLE charge
  ADD COLUMN relieved_at            TIMESTAMPTZ,
  ADD COLUMN relieved_by            TEXT REFERENCES "user"(id),
  ADD COLUMN relieved_reason        TEXT,
  ADD COLUMN relief_grant_id        TEXT REFERENCES financial_relief_grant(id),
  ADD COLUMN original_amount_pence  INTEGER,
  ADD CONSTRAINT charge_relief_consistent CHECK (
    (relieved_at IS NULL AND relieved_by IS NULL AND relieved_reason IS NULL AND original_amount_pence IS NULL)
    OR (relieved_at IS NOT NULL AND relieved_by IS NOT NULL AND relieved_reason IS NOT NULL)
  );
CREATE INDEX charge_relieved_at_idx ON charge(relieved_at) WHERE relieved_at IS NOT NULL;
```

**Reporting value for a relieved row** = `COALESCE(original_amount_pence, amount_pence)` when the charge was partially relieved (the original total), else `amount_pence` (full forgiveness). Aggregate queries use that expression.

**Reason categories** (closed enum, from brief):
`cost_of_living | low_income | temporary_change | multiple_family | unemployment | caring | other_personal | prefer_not_to_say`

**Volunteer option keys** (closed list):
`ground_work | scoring | umpiring | junior_sessions | womens_girls | bbq_kitchen | fundraising | social_media | admin | matchday_setup | transport | other | none`

After the migration: `pnpm run db:types`.

### Why not just flip `member_category = "bursary"`?

- Cannot report total value waived — the charges never exist.
- Cannot distinguish full vs partial relief, expiry, or applied-vs-active.
- Hides the rationale; future admins have no audit.

The hard-skip at `matchday/service.ts:761` and `:1086` is deleted in Phase 5 (no live bursary members today; the `bursary` category value remains allowed as a member_category but stops short-circuiting charge generation).

## Charge type taxonomy (verified against current code)

| Type                  | Where created                               | Relief coverage flag       |
| --------------------- | ------------------------------------------- | -------------------------- |
| `match_fee`           | `matchday/service.ts:774`, `:1099`          | `covers_match_fees`        |
| `membership`          | `payments/webhook-service.ts` (post-Stripe) | `covers_membership` \*     |
| `junior_membership`   | `payments/webhook-service.ts`               | `covers_membership` \*     |
| `junior_registration` | `junior/service.ts:131`                     | `covers_membership` \*     |
| `manual`              | `admin/service.ts` `createCharge`           | neither (admin discretion) |

\* Membership-family charges arrive **already paid** via Stripe webhook, so they're not auto-forgiven on creation. The "Apply membership relief" admin action is the manual path described in _Scope decisions_.

## API — new feature folder `apps/api/src/features/financial-relief/`

### Routes

| Verb | Path                                                      | Auth                   | Purpose                                                           |
| ---- | --------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| GET  | `/api/financial-relief/eligible-members`                  | `requireAuth`          | Returns self + linked juniors (id, name)                          |
| GET  | `/api/financial-relief/me`                                | `requireAuth`          | Caller's open/recent request + active grant summary               |
| POST | `/api/financial-relief/requests`                          | `requireAuth`          | Submit a new request                                              |
| POST | `/api/financial-relief/requests/:id/withdraw`             | `requireAuth` (owner)  | Member withdraws their own pending request                        |
| GET  | `/api/admin/financial-relief/requests`                    | `requireRole("admin")` | Paginated list with filters                                       |
| GET  | `/api/admin/financial-relief/requests/:id`                | `requireRole("admin")` | Full detail + events + linked grant                               |
| POST | `/api/admin/financial-relief/requests/:id/status`         | `requireRole("admin")` | Transition (in_review, more_info, decline)                        |
| POST | `/api/admin/financial-relief/requests/:id/decide`         | `requireRole("admin")` | Approve → creates grant + forgives match charges                  |
| POST | `/api/admin/financial-relief/grants/:id/close`            | `requireRole("admin")` | Close an active grant                                             |
| POST | `/api/admin/financial-relief/grants/:id/apply-membership` | `requireRole("admin")` | One-shot: create relieved membership charge + extend `paid_until` |
| GET  | `/api/admin/financial-relief/report`                      | `requireRole("admin")` | Aggregated totals for a date range                                |

### Submitter ownership (server-side)

The form's `memberId` field is **never trusted** from the client. The submit endpoint resolves the caller's user → member, then computes the allowed set:

- The caller's own member id
- Any member id where `member_parent_link.parent_member_id = caller.memberId` (juniors they're a parent for)

The same set powers `/eligible-members`. Submitting with a `memberId` outside that set returns 403.

### Service: decision flow (concurrency-safe)

```typescript
export function decideFinancialReliefRequest(db: Kysely<DB>, stripe: Stripe, send: SendEmail) {
  return async (adminUserId: string, requestId: string, data: Decide) => {
    return await db.transaction().execute(async (trx) => {
      // 1. Lock the member row to serialise concurrent decisions for the same member.
      const member = await trx
        .selectFrom("member")
        .where("id", "=", data.memberId)
        .selectAll()
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (member.deleted_at) throwHttpError(400, "Cannot grant relief to an archived member");

      // 2. Close any existing active grant — UNIQUE INDEX protects us either way.
      await trx.updateTable("financial_relief_grant")
        .set({ closed_at: now(), closed_by: adminUserId, closed_reason: "superseded" })
        .where("member_id", "=", data.memberId).where("closed_at", "is", null).execute();

      // 3. Insert new grant. If a race slipped past the lock, the partial UNIQUE INDEX rejects it.
      const grantId = crypto.randomUUID();
      await trx.insertInto("financial_relief_grant").values({...}).execute();

      // 4. Forgive existing unpaid, undeleted, unrelieved match-fee charges with no live Stripe PI.
      //    Crucially: for each candidate row, retrieve the PI and SKIP if it is in flight
      //    (status in ['requires_action','processing','succeeded','requires_capture']).
      //    Only forgive when PI is null OR status in ['canceled','requires_payment_method'].
      const candidates = await trx.selectFrom("charge")
        .where("member_id", "=", data.memberId)
        .where("type", "=", "match_fee")
        .where("deleted_at", "is", null)
        .where("relieved_at", "is", null)
        .where("paid_at", "is", null)
        .where("payment_confirmed_at", "is", null)
        .where("charge_date", ">=", data.effectiveFrom)
        .selectAll().forUpdate().execute();

      for (const c of candidates) {
        if (c.stripe_payment_intent_id) {
          const pi = await stripe.paymentIntents.retrieve(c.stripe_payment_intent_id);
          if (!["canceled", "requires_payment_method"].includes(pi.status)) continue;
          // Safe to detach.
          await trx.updateTable("charge")
            .set({ stripe_payment_intent_id: null })
            .where("id", "=", c.id).execute();
        }
        await trx.updateTable("charge")
          .set({ relieved_at: now(), relieved_by: adminUserId,
                 relieved_reason: "financial relief", relief_grant_id: grantId })
          .where("id", "=", c.id).execute();
      }

      // 5. Insert event row, update request status, send email (best-effort).
    });
  };
}
```

The **at-creation** helper used by `matchday/service.ts:774` and `:1099` looks up the active grant inside the same transaction that creates the charge — no race with the decide flow because both take the member row lock.

### Visibility rules in existing endpoints (all must change)

| Endpoint                                                                                          | Change                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `charges/service.ts` `getMyCharges`                                                               | Add `WHERE relieved_at IS NULL`                                                     |
| `charges/service.ts` `payOutstandingCharges`                                                      | Add `WHERE relieved_at IS NULL`                                                     |
| `charges/service.ts` `confirmPayment`                                                             | Add `WHERE relieved_at IS NULL` so a race can't mark a now-relieved row as paid     |
| `payments/webhook-service.ts` `payment_intent.succeeded` reconciliation                           | Add `WHERE relieved_at IS NULL` to the update; if the row is relieved, log and skip |
| `admin/service.ts` `listAllCharges`                                                               | Extend `chargeStatusSchema` with `"relieved"`; surface it; filter chip              |
| `admin/service.ts` `getChargeAggregates`                                                          | Treat relieved as its own bucket (not paid / unpaid)                                |
| `admin/service.ts` `markChargePaid`, `editCharge`, `chasePayment`, `deleteCharge`                 | Add `WHERE relieved_at IS NULL` guard; admin must close the grant before editing    |
| `matchday/service.ts` finish-emails query for unpaid match fees                                   | Add `WHERE relieved_at IS NULL`                                                     |
| `matchday/service.ts` `getOfficialMatchday` (`:205`) + `matchday/schemas.ts:185` (`chargePaidAt`) | Replace `chargePaidAt` with a small enum field `chargeStatus: 'unpaid'              | 'paid' | 'waived'`— captain sees`waived` (neutral, no relief language) and **never** the application text, grant note, or partial amount |
| `treasurer-tab` outstanding-payments aggregation                                                  | Exclude relieved from "outstanding"                                                 |
| `matchday/service.ts` cancellation guard (`:964`)                                                 | Currently throws if any non-deleted charges exist — change to also skip relieved    |
| `admin/service.ts` member archive (`archiveMember`)                                               | Close any active grant; force-decline any open request; insert event                |

### Schemas (Zod)

All in `financial-relief/schemas.ts`. Public ones are also exported from `packages/shared` so the form on the SPA can reuse them. Closed enums (`reasonCategorySchema`, `volunteerOptionSchema`, `durationSchema`, `contactPreferenceSchema`) live in `packages/shared/src/financial-relief.ts` alongside their human labels.

After schema changes: `pnpm run openapi:generate`.

## Frontend

### Member-facing

- **Route**: `/members/financial-relief` (new page under `apps/web/src/pages/members/financial-relief.tsx`). Linked from the existing members area dashboard with a single understated line: "Need help with fees? Request financial relief." No prominent visual treatment — dignity by default.
- **Form**: `react-hook-form` + `@hookform/resolvers/zod`, shadcn `Form` / `Input` / `Textarea` / `Checkbox` / `RadioGroup`. Pattern mirrors the junior registration form. Section copy verbatim from the brief.
- **Member-being-supported selector**: query the new `GET /api/financial-relief/eligible-members` to populate the choices. Server enforces ownership regardless of what the client posts.
- **Submission**: `useMutation` → POST `/api/financial-relief/requests`. On success, navigate to a confirmation screen with the privacy reassurance copy, not a toast.
- **Status view**: at the top of the page, if there's an open or recently-decided request, show the status pill (Submitted / In review / More information needed / Approved / Declined / Withdrawn / Expired) and the `member_facing_note` if set. Approval copy never restates billing mechanics ("Match donations for the 2026 season are waived.").

### Admin-facing

- **Tab**: new sub-tab under the **Finance** section in `admin-panel.tsx:64`, accessed via `/admin?section=finance&sub=financial-relief`, label "Financial Relief". Sits next to Charges / Sponsorships / Expenses.
- **List** (`financial-relief-tab.tsx`): follows `charges-tab.tsx` for structure.
  - `useReducer` for filters; URL state via `useSearchParams` (project convention: persist filters, pagination, status in the URL).
  - Columns: Submitted, Member, Account holder, Requested types (badges), Status pill, Decided by, Actions.
  - Filters: status (multi), date range, search (member name).
  - Row click opens a side panel with the full application, decision controls, the event log, and (if an active grant exists) the "Apply membership relief" button.
- **Decide dialog**: shadcn `Dialog`. Fields: decision (approved_full / approved_partial / approved_temporary), covered types (checkboxes), `membership_partial_pence` (only when partial + membership), effective from (defaults to today), `effective_to_exclusive` (defaults to next 1 Apr — start of season), admin notes (private), member-facing note (shown verbatim to member). Submitting runs the mutation and refreshes.
- **Decline path**: separate "Decline" action on the side panel — does NOT create a grant. Records `event_type='declined'` and sets `request.status='declined'`.
- **Apply membership relief**: form with `effectiveDate` (defaults today), `targetPaidUntil` (defaults end of season), and `amountPence` (defaults to current season's membership fee for that category). On submit, creates a relieved `charge` row with `type='membership'` and the supplied amount, and upserts a `membership` row extending `paid_until` to `targetPaidUntil`. Recorded as `event_type='membership_relief_applied'`.

### Reporting

A panel inside the new admin tab — not a separate dashboard — with two date inputs and a "Summarise" button calling `GET /api/admin/financial-relief/report`. Returns:

```typescript
{
  totalForgivenPence: number,                       // sum of reporting-value across relieved charges in range
  byReliefType: { membershipPence: number, matchFeePence: number },
  bySection: { juniors: Bucket, womens_girls: Bucket, senior: Bucket, other: Bucket },
  membersSupported: number,                         // distinct member_id with at least one relieved charge in range
  forgivenChargeCount: number
}
// Bucket = { pence: number; count: number; members: number }
```

Section is derived from the owning matchday team's `play_cricket_team.is_junior` plus opposition string (women/girls heuristic) for match fees; from `member.member_category` for membership. CSV export deferred.

## Notifications

Two new React Email templates:

- `FinancialReliefReceived.tsx` — to submitter; "We've received your request. We'll be in touch within X days."
- `FinancialReliefDecision.tsx` — to submitter; renders the approval/decline with `member_facing_note` only (never `admin_notes` or `reason_text`).

Email subject lines do not include the words "financial relief" — they read "Your request to Percy Main CC" so a glance at an inbox preview doesn't out the member.

A Slack post on submission, mirroring `incident-report/service.ts:27`, gated on `config.slackWebhookUrl`. Slack payload includes member name, requested types, and admin URL — **not** the reason text or full form contents.

## Privacy & access

- Full `financial_relief_request` rows are only returned by `requireRole("admin")` endpoints.
- The officials' matchday view shows `chargeStatus = 'waived'` — never the word "relief", the application reason, the grant note, or the partial amount.
- `member_facing_note` is the only admin-authored text that ever reaches the member.
- Slack notifications carry no reason text.
- Logs never log the request body of submit / decide endpoints; we log request IDs only.

## Tests

**Integration tests** (`financial-relief/integration.test.ts`, real PostgreSQL via testcontainers):

- Submit succeeds for own member; rejected (403) for a member id outside the eligible set.
- Submit twice while the first is open → second rejected by the unique partial index.
- Withdraw: owner can; non-owner cannot; decided request cannot.
- Approve full match relief → grant exists, request `approved`, existing unpaid match-fee charges have `relieved_at` set, **paid** match-fee charges untouched, **membership** charges untouched.
- Approve when an in-flight Stripe PI exists for one of the candidate charges → that charge is NOT forgiven; remainder are; event records the skip count.
- Race: two concurrent `decide` calls for the same member → exactly one succeeds (the other hits the unique index or the row lock).
- New matchday charge generation after approval → row created with `relieved_at` set in the same transaction.
- `getMyCharges` excludes relieved; `payOutstandingCharges` cannot bundle relieved; `confirmPayment` cannot flip a now-relieved row to paid (race).
- Webhook `payment_intent.succeeded` for a now-relieved charge: skipped, logged, not paid.
- Officials' matchday view shows `chargeStatus='waived'`; full application is not retrievable from this endpoint.
- Closing a grant: future matchday charges are no longer auto-forgiven; previously relieved are untouched.
- Member archival: active grant is closed; open request is force-declined; new submissions for the archived member are rejected.
- Apply membership relief: creates a relieved `charge` row with reporting value preserved, extends `membership.paid_until`, logs an event.
- Cancellation of a matchday with only relieved charges no longer blocks (current guard would).
- Admin `editCharge` / `markChargePaid` / `chasePayment` / `deleteCharge` reject on a relieved row.
- Aggregate report: forgiven totals match the sum of reporting-values across the date range; not double-counted; declined requests do not contribute.

**Service unit tests** for the at-creation helper edge cases — no active grant, expired grant (today >= `effective_to_exclusive`), type not covered, in-flight PI, deleted member.

**Frontend tests** — reducer tests (`*-tab.reducer.test.ts` pattern) and one React Testing Library smoke for the form.

## Build sequence (phased)

1. **Migration + types**: add migration (including the two unique partial indexes and the relief check constraint), run `pnpm run db:types`.
2. **API skeleton**: feature folder, schemas, service stubs returning 501. Register routes. Regenerate OpenAPI. `/api/financial-relief/eligible-members` lands here.
3. **Member submit + me + withdraw**: implement these + receipt email. Integration tests for these only.
4. **Admin list + detail + status transitions + decline path**: read endpoints + status transitions + decline (no grant). Admin tab list view.
5. **Decision flow + payment lifecycle changes**: implement `decide` with the locking + PI checks; add `applyReliefIfAny` to the two matchday charge-creation sites; add `relieved_at IS NULL` guards to `getMyCharges`, `payOutstandingCharges`, `confirmPayment`, the webhook reconciliation, finish-emails, all admin charge actions, the treasurer outstanding sums, and the matchday cancellation guard. Hook in member archival. Delete the bursary hard-skip. Frontend decide dialog. Decision email.
6. **Captain visibility**: change `getOfficialMatchday` to return `chargeStatus` enum; update the schema (`matchday/schemas.ts:185`) and the officials' UI.
7. **Apply-membership-relief admin action**: backend action + admin button + integration tests.
8. **Reporting endpoint + panel**: aggregates query (using `COALESCE(original_amount_pence, amount_pence)`), simple admin panel.

Each phase is a separate PR. Phases 1–6 are the minimum to satisfy the acceptance criteria; 7–8 are quality-of-life.

## ADR

Add `docs/adrs/NNN-financial-relief.md`:

- **Decision**: relief as an additive grant + per-charge audit columns on the existing `charge` table; match-fee relief is auto-applied at charge creation, membership relief is an explicit admin action.
- **Rejected**: (a) extending `member_category` only — loses reporting and history; (b) parallel `relief_ledger` table — duplicates `charge` state; (c) auto-forgiving membership at webhook time — webhook fires post-payment, no charge to forgive.
- **Consequences**: `chargeStatusSchema` gains `"relieved"` (admin) / `"waived"` (officials); the unpaid bursary hard-skip in `matchday/service.ts` is removed; `original_amount_pence` is set only for partial relief so reporting can sum `COALESCE(original_amount_pence, amount_pence)`.

## Acceptance-criteria mapping

| Criterion                                                                  | Where satisfied                                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Logged-in member can submit a financial relief request                     | `POST /api/financial-relief/requests`, member page                   |
| Member can submit for self and linked juniors only                         | `/eligible-members` + server-side ownership check                    |
| One open request per member                                                | Unique partial index `financial_relief_request_one_open_uidx`        |
| Admin can review and decide the request                                    | Admin tab + `decide` / `status` / decline endpoints                  |
| Approved relief can be tied to future eligible match charges               | At-creation helper called from `matchday/service.ts:774`, `:1099`    |
| Eligible future charges marked relieved                                    | `relieved_at/by/reason/relief_grant_id` columns                      |
| Forgiven charges retain monetary value for reporting                       | `amount_pence` unchanged on full; `original_amount_pence` on partial |
| Forgiven charges do not appear as unpaid debt                              | `relieved_at IS NULL` guards everywhere                              |
| In-flight Stripe payments cannot be relieved out from under                | PI status check in `decide`; webhook reconciliation guard            |
| Concurrent admin decisions can't double-grant                              | Member row lock + unique partial index                               |
| Full request details visible only to admin                                 | `requireRole("admin")` on detail endpoints                           |
| Captains see neutral match fee status only, not full application or reason | `chargeStatus = 'waived'` in officials' matchday endpoint            |
| Admin/reporting can show total value over a period                         | `/api/admin/financial-relief/report`                                 |
| Public-facing reports aggregate/anonymised                                 | Report response has totals only                                      |
| Matchday cancellation does not break on relieved charges                   | Cancellation guard excludes relieved                                 |
| Member archival closes grants + open requests                              | `archiveMember` hook                                                 |
| Membership relief covered (v1: admin-applied)                              | `/grants/:id/apply-membership` endpoint                              |
