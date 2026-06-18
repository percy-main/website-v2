# Expenses + Stripe Payouts - Implementation Plan

Status: DECISIONS RESOLVED / ready to build. Author: planning pass, 2026-06-18.

All open questions from the first draft have been answered by Alex and are folded
into the design below. The resolved answers are recorded in section 13.

## 1. Goal and use case

Let approved club volunteers submit out-of-pocket expenses and get reimbursed,
with a fully auditable approval workflow and an admin dashboard.

Flow:

1. **Submit** - a user with the `expense_submitter` role adds an expense:
   description, amount, optional receipt image (mandatory over GBP 10), proposed
   tags, and their payout details (entered directly into Stripe, see section 6).
2. **Decide** - users with the `expense_approver` role are notified by email,
   approve or deny, and finalise the tags. Expenses of GBP 50 or more need two
   distinct approvers.
3. **Notify** - the submitter is notified by email of the decision.
4. **Pay** - once fully approved, the submitter is paid via Stripe Global
   Payouts using the bank details Stripe is holding for them.

Hard requirements: auditable, controlled (separation of duties + two-approver
threshold), admin dashboard showing pending / approved / denied / paid plus
aggregated totals.

## 2. TL;DR

- **Chosen payout rail: Stripe Global Payouts** (recipients + OutboundPayments).
  Stripe "Payouts" only pays your own bank account; paying a club member needs
  Global Payouts. The account is already eligible and activated (decision 13.2).
- **Stripe holds the bank details.** The payee enters their bank account into a
  Stripe-hosted form; we persist only token IDs
  (`stripe_recipient_account_id`, `stripe_payout_method_id`), never a sort code
  or account number. This is the data-minimising answer to the legal question
  (decision 13.1).
- **Build in phases.** Phase 1 ships the full audited workflow (tags,
  two-approver rule, notifications, dashboard) with a manual "mark paid"
  fallback. Phase 2 wires the one-click Global Payouts payout. Phasing is kept
  because Global Payouts is still on Stripe's **public-preview v2 API**, a
  different surface and SDK channel from the v1 (Basil) integration this repo
  uses today (section 7).
- **Matchday expenses are out of scope** (decision 13.8). This is a brand new,
  standalone feature.

## 3. Repo patterns to reuse

| Concern | Existing asset | Notes |
| --- | --- | --- |
| Approve/deny + email-on-decision template | `apps/api/src/features/financial-relief/` (CRUD, status transitions, decision email, DI deps) | Primary template for the workflow + notify lifecycle. |
| Roles | `packages/shared/src/auth/permissions.ts` (`statements`, `roles`, `ALL_PERMS`, `ASSIGNABLE_ROLES`, `ROLE_LABELS`). Existing `finance_viewer` / `finance_admin`. | Roles persist as a comma-separated string in `user.role`. `checkPermission()` shared FE/BE. |
| Route auth | `requirePermission(resource, action)` preHandler + `getAuthSession(request)` in `apps/api/src/features/auth/middleware.ts` | 401 / 403 handled for us. |
| Receipt upload | `app.s3.uploadReceipt(...)` in `apps/api/src/lib/s3-upload.ts` (base64 data-URL in JSON body, 5MB cap, jpeg/png/webp/heic). Config `S3_RECEIPT_PREFIX`. | Generic infra; reuse directly. Retain images indefinitely (decision 13.9). |
| Email to a user | `app.send({ to, subject, html })` + React Email templates in `packages/email/src/templates/`. Model on `FinancialReliefDecision.tsx`. | SES via `createSesSend`; dev viewer on port 5174. |
| Stripe v1 client | `createStripe({ stripeSecretKey })` in `apps/api/src/features/payments/stripe.ts`. `stripe@^22.2.1` (Basil, v1). Clients created per-plugin, injected into curried services. | The v2 Global Payouts client must be a SEPARATE instance (section 7). |
| Stripe v1 webhooks | `apps/api/src/features/payments/webhook.ts` + `stripe_webhook_event` idempotency table + encapsulated raw-body parser + `StripeWebhookTerminalError` | The v2 money-movement events use a DIFFERENT delivery mechanism (section 7). |
| Money | integer `*_amount_pence` columns, currency hardcoded `"gbp"`. | Format with `Intl.NumberFormat("en-GB", { currency: "GBP" })`. |
| Admin UI | React Router v7 + react-query + typed client (`apps/web/src/lib/api-client.ts`). Tabs in `apps/web/src/pages/admin/admin-panel.tsx` (`SECTIONS`). Model the page on `apps/web/src/pages/admin/expense-history-tab.tsx`. | Finance section already exists. |
| Migrations | `pnpm db:migration` -> write `up()` -> `pnpm db:up` -> `pnpm db:types` -> `pnpm openapi:generate`. Skills: `add-migration`, `add-endpoint`, `write-tests`. | Clean create-table template: `packages/db/src/migrations/2026-05-21T21:13:05.080Z.ts`. |

New standalone feature folder: `apps/api/src/features/expense/`
(`routes.ts`, `service.ts`, `schemas.ts`, `service.test.ts`, `integration.test.ts`).

## 4. Data model

New tables via Kysely migration. All money as integer pence.

### `expense`
- `id` uuid pk
- `created_by` -> `user.id` (submitter)
- `claimant_name` text (display name at submit time)
- `description` text not null
- `amount_pence` integer not null (check > 0)
- `currency` text not null default `'gbp'`
- `status` text not null - one of
  `pending` / `awaiting_second_approval` / `approved` / `denied` / `paid` / `payout_failed`
- `receipt_image_url` text null (required at submit when `amount_pence > 1000`, decision 13.9)
- payout linkage (Phase 2, nullable in Phase 1):
  - `stripe_recipient_account_id` text null
  - `stripe_payout_method_id` text null
  - `stripe_outbound_payment_id` text null (unique - guards double-pay)
  - `paid_at` timestamptz null
- `created_at` / `updated_at` timestamptz not null default now()

Indexes: `status`, `created_by`. Receipt-required rule enforced in the submit
service/schema, not as a pure column check (it depends on amount).

### `expense_approval` (enforces the two-approver rule + separation of duties)
- `id` uuid pk
- `expense_id` -> `expense.id` on delete cascade
- `approver_user_id` -> `user.id`
- `decision` text - `approved` / `denied`
- `note` text null
- `created_at` timestamptz not null default now()
- unique `(expense_id, approver_user_id)` - one decision per approver, so the
  same person cannot supply both required approvals.

Status is derived from approvals + the threshold (section 9). The submitter is
never permitted a row here.

### `expense_category` (admin-editable tag vocabulary, decision 13.4)
- `id` uuid pk
- `name` citext unique (case-insensitive dedupe)
- `created_by` -> `user.id` null
- `archived_at` timestamptz null (soft-retire; keeps historical links valid)
- `created_at` timestamptz not null default now()

### `expense_category_link` (many-to-many: an expense has one or more tags)
- `expense_id` -> `expense.id` on delete cascade
- `category_id` -> `expense_category.id`
- composite pk `(expense_id, category_id)`

Tags: the claimant proposes one or more at submit (pick existing or create new);
the approver can add/remove at decision; creating a "new" tag upserts into
`expense_category` by name so the vocabulary grows but stays deduplicated. At
least one tag is required to reach `approved`.

### `expense_event` (append-only audit log)
- `id` uuid pk
- `expense_id` -> `expense.id` on delete cascade
- `actor_user_id` -> `user.id` null (null for Stripe-system events)
- `type` text - `submitted` / `approved` / `denied` / `edited` / `tags_changed` / `payout_initiated` / `payout_paid` / `payout_failed`
- `from_status` text null, `to_status` text null
- `metadata` jsonb null (amounts, notes, tag ids, stripe ids, failure reason)
- `created_at` timestamptz not null default now()

Every transition writes one `expense_event` in the same DB transaction as the
`expense`/`expense_approval` write. The log is never updated or deleted.

## 5. Roles and permissions

Add an `expenses` resource to `packages/shared/src/auth/permissions.ts`
(`statements`, `roles`, `ALL_PERMS`, `ASSIGNABLE_ROLES`, `ROLE_LABELS`).

Actions: `submit`, `view_own`, `view`, `approve`, `pay`, `manage_tags`.

Roles:
- `expense_submitter` -> `expenses: ["submit", "view_own"]`.
- `expense_approver` -> `expenses: ["view", "approve"]`.
- `pay` and the full dashboard granted to the existing `finance_admin` /
  treasurer role (decision 13.6 reuses the existing key; no fourth role needed).
- `manage_tags` (rename/archive the canonical tag list) -> `finance_admin`.
  Submitters/approvers can still create new tags inline via proposal.

Controls / separation of duties:
- An approver cannot approve their own submission (no `expense_approval` row
  where `approver_user_id == created_by`).
- The two required approvals (for GBP 50+) must come from two distinct users
  (enforced by the unique `(expense_id, approver_user_id)`).
- `pay` is a distinct permission from `approve`.
- Amount and description are immutable after the first approval; editing them
  resets the expense to `pending`, clears existing approvals, and logs an
  `edited` event.

## 6. Payout mechanism and the bank-details question (Option A, decided)

Decision 13.1: **Stripe Global Payouts, with Stripe holding the bank details.**

- On (full) approval, the submitter completes a Stripe-hosted recipient /
  payout-method form. **Stripe stores the bank details.** We persist only the
  recipient account id and payout method id.
- Reimbursement is an OutboundPayment from a Stripe-managed Financial Account,
  funded from the club's existing Stripe GBP balance (donations / membership /
  charges already settle there).
- Repeat claimants reuse their stored recipient, so they enter bank details once.
- We never hold the sort code / account number, which is the data-minimising
  outcome the brief wanted.
- Cost: GBP 0.50 per domestic payout, no monthly fee, free FPS top-up.

Rejected alternatives (recorded for the ADR): storing bank details ourselves
(needless GDPR/encryption/retention burden) and a pure manual-transfer model
(kept only as the Phase 1 fallback, below).

## 7. Stripe Global Payouts integration specifics (Phase 2)

Verified against Stripe docs during planning; re-confirm at build time as the
product is in preview.

- **Product:** Global Payouts. Pay third parties with no Stripe account. UK
  platform paying GBP to UK recipients is supported. Account already eligible +
  activated (decision 13.2).
- **API surface (v2, preview):**
  - Recipient: `POST /v2/core/accounts` (Accounts v2) with
    `identity.entity_type = "individual"`, `identity.country = "gb"`,
    `contact_email`, `display_name`, and
    `configuration.recipient.capabilities.bank_accounts.local.requested = true`.
  - Payout methods: `/v2/money_management/payout_methods` (Stripe stores the
    bank account; default via
    `configuration.recipient.default_outbound_destination`).
  - Payout: `POST /v2/money_management/outbound_payments` with
    `from.financial_account`, `to.recipient`, `amount.value` (pence),
    `amount.currency = "gbp"`, `description`.
- **Financial Account:** activated. Funded from the Stripe payments balance / FPS.
- **SDK / client isolation:** the repo pins `stripe@^22` on v1 Basil and does
  not set `apiVersion`. Global Payouts needs the public-preview SDK channel and a
  preview `Stripe-Version` header. Introduce a SEPARATE dedicated v2 client (e.g.
  `createStripePayouts(...)`) so live v1 payments flows are untouched. The same
  `STRIPE_SECRET_KEY` carries the capability (decision 13.6).
- **Webhooks (decision 13.7):** handle OutboundPayment status via a v2 event
  destination, developed locally with the Stripe CLI webhook forwarder
  (`stripe listen`). This is a different mechanism (thin events) from the v1
  `/api/stripe/webhook` handler, so it gets its own small endpoint. The unique
  `stripe_outbound_payment_id` column plus the `expense_event` log give us
  idempotency regardless of delivery.
- **Identity / KYC:** read the live `requirements.summary` per recipient at
  integration time rather than assuming the field set.

### New config (`apps/api/src/config.ts`)
Required env vars (Terraform threads placeholders, per repo convention):
- `STRIPE_FINANCIAL_ACCOUNT_ID`
- `STRIPE_PAYOUTS_API_VERSION` (preview version string)

`STRIPE_SECRET_KEY` is reused.

## 8. State machine and controls

Threshold: `TWO_APPROVAL_THRESHOLD_PENCE = 5000` (GBP 50, decision 13.5).

```
                         amount < 5000
pending --1st approve--> ------------------> approved --pay--> paid
   |                |                            ^               |
   |                | amount >= 5000             |               +--(error)--> payout_failed --retry--> paid
   |                v                            |
   |        awaiting_second_approval --2nd approve (distinct user)--+
   |                |
   +---deny---------+--> denied
```

- A single `deny` from any approver moves the expense to `denied` (with note).
- At least one tag and (for amounts over GBP 10) a receipt are required before
  approval can complete.
- Payout is idempotent: only `approved` (or `payout_failed` for retry) may be
  paid, guarded by the unique `stripe_outbound_payment_id`.
- Every transition writes an `expense_event` in the same transaction.

## 9. Notifications

Reuse `app.send` + new React Email templates in `packages/email/src/templates/`:
- On submit: email every user holding `expense_approver` (decision 13.3).
- On first approval of a GBP 50+ expense: email the approver pool that a second
  approval is needed.
- On final decision (approved/denied + note): email the submitter. Model on
  `FinancialReliefDecision.tsx`.
- On paid (Phase 2): email the submitter that the payout is on its way.

All sends are best-effort (try/catch + log), matching `financial-relief`.

## 10. API endpoints (`apps/api/src/features/expense/`)

Via the `add-endpoint` skill (Zod schemas, curried services, OpenAPI regen,
typed client):
- `POST /api/expenses` - submit (`expenses:submit`). description, amount,
  optional `receiptImage` data-URL (required when amount > GBP 10), proposed
  tag names/ids.
- `GET /api/expenses` - list; own only for `view_own`, all for `view`. Filters:
  status, tag, date range, search; pagination. URL-driven filter state on the web.
- `GET /api/expenses/:id` - detail + approvals + event history.
- `POST /api/expenses/:id/decision` - approve or deny + note + final tag set
  (`expenses:approve`; not self; enforces distinct second approver for GBP 50+).
- `POST /api/expenses/:id/payout` - initiate Global Payouts payout
  (`expenses:pay`, Phase 2). Phase 1 fallback: `POST /api/expenses/:id/mark-paid`.
- `GET /api/expenses/summary` - aggregated totals by status / tag / period.
- `GET /api/expense-categories` - list active tags (for the proposal/edit UI).
- `POST /api/expense-categories` - create a tag (any submitter/approver).
- `PATCH /api/expense-categories/:id` - rename/archive (`expenses:manage_tags`).

## 11. Admin dashboard (`apps/web`)

- New "Expenses" sub-tab under the Finance section in
  `apps/web/src/pages/admin/admin-panel.tsx`, gated by `expenses:view`.
- List/table modelled on `apps/web/src/pages/admin/expense-history-tab.tsx`
  (filters incl. tag, debounced search, pagination, detail dialog with approval
  history, receipt lightbox, CSV export, react-query + typed client).
- Summary widgets: totals by status and by tag, period filter.
- Separate lightweight submitter view ("my expenses" + submit form with tag
  proposal) for users holding only `expense_submitter`.

## 12. Testing

This is a money-movement feature, so coverage is expected, not optional:
- Unit tests (mocked DB) for the status machine: single vs two-approver paths,
  self-approval rejection, distinct-approver enforcement, receipt-required rule,
  tag-required-on-approval, payout idempotency.
- Integration tests (testcontainers) for submit -> approve -> pay, the audit
  log, and the category upsert/dedupe.
- Phase 2: a Stripe payout test against a local test account with the CLI
  webhook forwarder (decision 13.7).

## 13. Decisions log (resolved open questions)

1. **Legal / data protection:** Option A - Stripe Global Payouts; Stripe holds
   the bank details, we store only token IDs.
2. **Global Payouts eligibility:** account is eligible and activated.
3. **Approver routing:** email every user holding `expense_approver`.
4. **Tags:** admin-editable vocabulary. Claimant proposes tags, approver can
   edit; new tags allowed alongside existing ones. (Replaces the original single
   fixed category.)
5. **Thresholds:** under GBP 50 = one approver; GBP 50+ = two distinct approvers.
   Start simple.
6. **Stripe key:** existing `STRIPE_SECRET_KEY` carries the capability.
7. **v2 webhook vs polling:** use webhooks (v2 event destination), developed
   locally with a test account + the Stripe CLI webhook forwarder.
8. **Matchday expenses:** out of scope; barely used, has not landed. Build new.
9. **Receipts:** retain indefinitely (low volume); receipt mandatory over GBP 10.

### Phase 0 spike findings (resolved 2026-06-18)

Probed the pinned `stripe@22.2.1` SDK directly:

- It exposes a `v2` namespace with **`v2.core.accounts`** (recipient creation),
  **`v2.core.eventDestinations`** and **`v2.core.events`** (v2 webhooks). It does
  NOT bundle the `MoneyManagement` resources (OutboundPayments / PayoutMethods /
  FinancialAccounts) - those ship only in newer preview SDK releases.
- It DOES expose **`stripe.rawRequest(method, path, params, options)`** plus
  `Stripe-Context` header support (`stripeContext` option / `StripeContext`
  helper) and per-call `apiVersion`.

Decision: **do not bump the SDK.** Phase 2 calls the preview money-movement
endpoints (`/v2/money_management/payout_methods`,
`/v2/money_management/outbound_payments`) via `rawRequest` on a dedicated
`Stripe` instance constructed with the preview `apiVersion`
(`STRIPE_PAYOUTS_API_VERSION`) and the shared `STRIPE_SECRET_KEY`. Recipient
creation can use the typed `v2.core.accounts`. This isolates the preview surface
entirely from the live v1 (Basil) payments client and avoids the dependency-bump
risk to existing flows. The thin client wrapper lives in
`apps/api/src/features/expense/payouts.ts`.

Still confirmed only against docs (re-verify against the live test account when
wiring Phase 2 end to end): the exact preview `Stripe-Version` value, the
OutboundPayment event names, and the live `requirements` set for a UK individual
recipient. These are config / mapping details, not architectural blockers.

## 14. Phased delivery

- **Phase 0 (spike, ~0.5 day):** install the preview v2 SDK, create a test
  recipient + payout method, fire a test OutboundPayment, confirm event names via
  `stripe listen`, and read the live UK-individual `requirements`. Resolves the
  residual unknowns above.
- **Phase 1 (workflow):** roles + permissions; `expense`, `expense_approval`,
  `expense_category`, `expense_category_link`, `expense_event` tables; submit
  (with receipt rule + tag proposal); the one/two-approver decision flow; tag
  management; email notifications; admin dashboard + aggregated totals; manual
  `mark-paid` fallback; full unit + integration tests.
- **Phase 2 (Stripe rail):** dedicated v2 client; Stripe-hosted recipient +
  payout-method collection; OutboundPayment with idempotency; v2 webhook
  endpoint for payout status; paid notification. Manual path retained as fallback.
- **ADR:** record Global Payouts vs Connect vs manual, and the "Stripe holds the
  bank details" data-minimisation choice, via the `add-adr` skill.
