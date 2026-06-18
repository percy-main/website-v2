# Payout test plan (Stripe Global Payouts) - handoff

Status: the Stripe sandbox + Global Payouts Financial Account is being provisioned.
This is the runbook to verify the **real** v2 payout path once the sandbox keys
are available. Pick this up when the keys land.

## Why this exists

Phase 1 (submit -> approve/deny -> notify -> manual mark-paid) and the payout
**state machine** are fully tested (browser walkthrough + 26 integration tests
with a fake Stripe client). What is NOT yet proven is the actual Stripe v2
money-movement surface in [`apps/api/src/features/expense/payouts.ts`](apps/api/src/features/expense/payouts.ts):
the request/response shapes, the preview API version, and the webhook event
names were written from docs, not exercised against Stripe.

Until the payout env vars are set, `createPayoutsClient` returns `null` and the
payout endpoint returns `503 Stripe Global Payouts is not configured`. That 503
is the only thing the "Pay via Stripe" button has actually done so far.

Goal of this plan: drive a real recipient -> bank-details -> OutboundPayment ->
webhook cycle in the sandbox, and fix any shape mismatches in `payouts.ts` /
`service.ts` / `routes.ts`.

## 0. Prerequisites

- A Stripe **sandbox** with Global Payouts enabled and a **Financial Account**
  activated (Dashboard -> Balances -> Financial account -> Get started).
- The Financial Account funded with test money (Global Payouts pays from the FA
  balance; an OutboundPayment fails if the balance is 0). Top it up in the
  sandbox dashboard.
- Tools: Docker, `pnpm`, and the [Stripe CLI](https://docs.stripe.com/stripe-cli)
  (`stripe login` against the sandbox).

## 1. Configure env

Edit `apps/api/.env` (gitignored, local only) and set:

| Var                             | Where it comes from                                                             |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | the sandbox secret key (replaces the old legacy `sk_test_…`)                    |
| `STRIPE_FINANCIAL_ACCOUNT_ID`   | the `fa_…` id of the activated Financial Account                                |
| `STRIPE_PAYOUTS_API_VERSION`    | the exact preview version string the sandbox expects, e.g. `2026-05-27.preview` |
| `STRIPE_PAYOUTS_WEBHOOK_SECRET` | from `stripe listen` in step 2 (set it, then restart the API)                   |

Config lives in [`apps/api/src/config.ts`](apps/api/src/config.ts) (the three
new vars are placeholder-tolerant, so a wrong/blank value will not crash boot -
but it WILL make the client null or the calls fail). The client is built in
[`routes.ts`](apps/api/src/features/expense/routes.ts) via `createPayoutsClient`.

## 2. Start the stack + webhook forwarder

```bash
docker compose up -d
pnpm db:up                       # apply migrations to the local DB
pnpm dev:api                     # API on :3000  (reads apps/api/.env)
pnpm dev:web                     # web on :5173

# Separate terminal - forward the v2 payout webhook and capture the secret:
stripe listen --forward-to localhost:3000/api/stripe/payouts-webhook
#   -> prints "whsec_..."; put it in STRIPE_PAYOUTS_WEBHOOK_SECRET and restart dev:api
```

Note: `pnpm dev` (scripts/dev.sh) auto-forwards Stripe to the **v1** webhook
(`/api/stripe/webhook`). The payout webhook is a **separate** endpoint, so run
the `stripe listen` above explicitly.

## 3. Seed two users (submitter + a distinct approver)

Self-approval is blocked, so you need a submitter and a separate approver who
also holds `pay` (finance_admin). The local DB has no password-hash seeder, so
register via the auth API then flip verification + roles in the DB.

```bash
# Register (creates user + password account; unverified)
curl -s -X POST http://localhost:3000/api/auth/sign-up/email -H 'Content-Type: application/json' \
  -d '{"name":"Alice Submitter","email":"alice@test.local","password":"Password123!"}' -o /dev/null -w "%{http_code}\n"
curl -s -X POST http://localhost:3000/api/auth/sign-up/email -H 'Content-Type: application/json' \
  -d '{"name":"Bob Approver","email":"bob@test.local","password":"Password123!"}' -o /dev/null -w "%{http_code}\n"

# Verify email + assign roles (bypasses the email link)
docker compose exec -T postgres psql -U percy -d percy_main -c "
  UPDATE \"user\" SET \"emailVerified\"=true, role='expense_submitter' WHERE email='alice@test.local';
  UPDATE \"user\" SET \"emailVerified\"=true, role='expense_approver,finance_admin,expense_submitter' WHERE email='bob@test.local';"
```

Roles are defined in [`packages/shared/src/auth/permissions.ts`](packages/shared/src/auth/permissions.ts):
`expense_submitter` (submit), `expense_approver` (approve), `finance_admin`
(view + **pay** + manage_tags).

## 4. Create an approved claim

```bash
# Sign in as the submitter and raise a claim (<= GBP 10 so no receipt is needed)
curl -s -X POST http://localhost:3000/api/auth/sign-in/email -H 'Content-Type: application/json' \
  -d '{"email":"alice@test.local","password":"Password123!"}' -c /tmp/alice.cookies -o /dev/null -w "%{http_code}\n"
curl -s -X POST http://localhost:3000/api/expenses -H 'Content-Type: application/json' -b /tmp/alice.cookies \
  -d '{"description":"Coffees for the umpires","amountPence":850,"tagNames":["hospitality"]}'
```

Then approve it as Bob in the browser: log in at `http://localhost:5173/auth/login`
(bob@test.local / Password123!), go to
`http://localhost:5173/admin?section=finance&sub=reimbursements`, open Alice's
claim, click **Approve**. Status should become `Approved` and the actions become
**Pay via Stripe** / **Mark paid (manual)**.

## 5. Drive the real payout (the part that needs verifying)

The flow is in `payoutExpense` ([`service.ts`](apps/api/src/features/expense/service.ts)).
Keep the API logs visible - failures are caught and written to
`payout_failure_reason` (surfaced in the dialog) and logged as
`expense_payout_failed`, so Stripe's error text is your debugging signal.

**Step A - first payout attempt (no bank details yet).** Click **Pay via Stripe**.
Expected: a recipient is created and, because the recipient has no payout method,
the response carries an `onboardingUrl` and the dialog shows
"The claimant needs to add their bank details first". Status stays `Approved`.

- Verifies: `createRecipient` (`POST /v2/core/accounts`) and
  `createPayoutMethodSetupLink` (`POST /v2/core/account_links`).
- If it 500s or records a failure instead: the request body or the
  `account_links` `use_case` shape is wrong - fix in `payouts.ts`.

**Step B - complete Stripe-hosted onboarding.** Open the `onboardingUrl`. Enter
the GB test identity + bank details Stripe documents for sandboxes (commonly
sort code `10-88-00`, account `00012345` - confirm against Stripe's current
testing docs). This is where Stripe collects + stores the bank details, so we
never do.

- Verifies: the recipient `requirements` we send are sufficient for a GB
  individual. If onboarding demands fields we did not request, note them; the
  capability request in `createRecipient` may need expanding.

**Step C - second payout attempt (bank details on file).** Click **Pay via
Stripe** again. Expected: an OutboundPayment is created, status -> `Paid`,
`stripe_outbound_payment_id` stored, claimant emailed.

- Verifies: `getDefaultPayoutMethodId`
  (`GET /v2/money_management/payout_methods` + `Stripe-Context` header) and
  `createOutboundPayment` (`POST /v2/money_management/outbound_payments`).
- Check the real `op.status` value returned (logged in the `payout_initiated`
  event metadata as `stripeStatus`). The code treats `failed`/`returned`/
  `canceled` as terminal failure and everything else as optimistic paid - adjust
  the `terminalFailure` set in `service.ts` if the real status vocabulary differs.

**Step D - webhook.** Watch the `stripe listen` terminal and the API logs as the
OutboundPayment settles. Expected: an event arrives, `applyPayoutWebhook` runs,
and the status is confirmed (or corrected to `payout_failed`).

- Verifies `mapOutboundPaymentEvent` (event `type` strings) and
  `outboundPaymentIdFromEvent` (id at `data.object.id` vs `related_object.id`),
  both in [`payouts.ts`](apps/api/src/features/expense/payouts.ts) /
  [`routes.ts`](apps/api/src/features/expense/routes.ts).
- If the webhook arrives but nothing updates: the event `type` did not match
  (fix the suffix checks) or the id was read from the wrong field. Log the raw
  event to see the real shape:
  `stripe listen --print-json` in a scratch terminal, or temporarily log
  `event.type` + `JSON.stringify(event)` in the webhook handler.

## 6. Verification checklist (what was guessed, confirm each)

- [ ] `STRIPE_PAYOUTS_API_VERSION` value is accepted (a wrong version yields a
      Stripe error on the first call).
- [ ] `createRecipient` body shape (`identity`, `configuration.recipient.capabilities`).
- [ ] Live `requirements` for a GB individual recipient.
- [ ] `createPayoutMethodSetupLink` `use_case` shape + returned URL.
- [ ] `getDefaultPayoutMethodId` list response (`data[0].id`) and the
      `Stripe-Context` header behaviour.
- [ ] `createOutboundPayment` body (`from`/`to`/`amount`) and the `status`
      vocabulary it returns.
- [ ] Webhook event `type` strings and id location.
- [ ] Idempotency: a double-click on Pay does not create two OutboundPayments
      (key = expense id); a `payout_failed` retry creates a fresh one.

## 7. Failure-path check

With the FA balance at 0 (or below the claim amount), trigger a payout. Expect
status -> `payout_failed` with the Stripe error in `payout_failure_reason`, and
"Pay via Stripe" / "Mark paid (manual)" still available to retry.

## 8. Optional quick probe (validate shapes before the full UI flow)

To sanity-check the recipient call without the whole flow, run this throwaway
script (delete after). It hits the real sandbox via the same `rawRequest` path
the client uses and prints the recipient + its `requirements`:

```ts
// apps/api/scratch-probe.mts  (run: cd apps/api && pnpm exec tsx --env-file=.env scratch-probe.mts)
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const v = process.env.STRIPE_PAYOUTS_API_VERSION!;
try {
  const acct = await stripe.rawRequest(
    "POST",
    "/v2/core/accounts",
    {
      display_name: "Probe Recipient",
      contact_email: "probe@example.com",
      identity: { country: "gb", entity_type: "individual" },
      configuration: {
        recipient: {
          capabilities: { bank_accounts: { local: { requested: true } } },
        },
      },
      include: ["requirements", "configuration.recipient"],
    },
    { apiVersion: v },
  );
  console.log(JSON.stringify(acct, null, 2));
} catch (e) {
  console.error("PROBE FAILED:", e);
}
```

A clean response confirms auth + version + the recipient body. The
`requirements` block tells you exactly what onboarding will demand.

## 9. Cleanup

```bash
# stop dev servers
lsof -ti tcp:3000,tcp:5173 -sTCP:LISTEN | xargs kill
# remove local test users (optional; local DB only)
docker compose exec -T postgres psql -U percy -d percy_main -c "
  DELETE FROM \"user\" WHERE email IN ('alice@test.local','bob@test.local');"
rm -f apps/api/scratch-probe.mts /tmp/alice.cookies
```

## Quick reference

- Payout endpoint: `POST /api/expenses/:expenseId/payout` (perm `expenses:pay`).
- Webhook: `POST /api/stripe/payouts-webhook` (raw body, separate signing secret).
- Client: [`apps/api/src/features/expense/payouts.ts`](apps/api/src/features/expense/payouts.ts).
- Orchestration: `payoutExpense` + `applyPayoutWebhook` in
  [`apps/api/src/features/expense/service.ts`](apps/api/src/features/expense/service.ts).
- Decisions + residual notes: [`EXPENSES.md`](EXPENSES.md),
  [ADR 050](docs/adrs/050-reimbursement-payouts-stripe-global-payouts.md),
  [ADR 051](docs/adrs/051-stripe-global-payouts-raw-request-isolation.md).

When the real shapes are confirmed and any fixes are in, update the "residual"
note in EXPENSES.md and this file's status line, and consider replacing the
fake-client payout tests with a sandbox smoke test gated on the env vars.
