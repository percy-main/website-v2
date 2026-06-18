# ADR 051: Drive preview v2 Global Payouts via rawRequest on an isolated client

## Status

Accepted

## Context

[ADR 050](050-reimbursement-payouts-stripe-global-payouts.md) chose Stripe
Global Payouts to reimburse volunteers. Global Payouts lives on Stripe's
**preview v2 API** (`/v2/core/accounts`, `/v2/money_management/*`), which
differs from the v1 (Basil) API every other Stripe integration in this repo
uses (PaymentIntents for donations, subscriptions for membership, the existing
`/api/stripe/webhook`).

A Phase 0 spike probed the pinned `stripe@22.2.1` SDK and found:

- It exposes `v2.core.accounts` (recipient creation) and
  `v2.core.eventDestinations`/`events` (v2 webhooks), **but not** the
  `MoneyManagement` resources (OutboundPayments, PayoutMethods,
  FinancialAccounts) - those ship only in newer preview SDK releases.
- It does expose `stripe.rawRequest(method, path, params, options)` with
  per-request `apiVersion`, `stripeContext`, and `idempotencyKey` options, plus
  `webhooks.constructEvent` (whose signature scheme also covers v2 thin events).

So to actually send a payout we either bump the SDK to a preview channel, or
call the preview endpoints through `rawRequest`.

## Decision

Do **not** bump the SDK. Call the preview money-movement endpoints via
`stripe.rawRequest` on a **dedicated `Stripe` instance** constructed in
`apps/api/src/features/expense/payouts.ts`, with the preview `apiVersion`
(`STRIPE_PAYOUTS_API_VERSION`) passed as a per-request option on every call.
The live v1 (Basil) payments client elsewhere is left completely untouched.

`createPayoutsClient(config)` returns `null` when the Financial Account id or
preview version is unset, and callers treat null as "payouts not configured"
and surface a clear error. The config vars are placeholder-tolerant (not hard
`z.string()` required) so the API still boots everywhere before the preview
Financial Account is provisioned.

## Problem

- **A global SDK bump is blast-radius risk.** The pinned `stripe@22` SDK
  default-pins the v1 Basil wire format that donations, membership, charges,
  and sponsorship all depend on (including bespoke Basil-vs-legacy invoice
  handling in `features/payments`). Upgrading the shared dependency to chase a
  preview feature risks regressing flows that move real money today.
- **Preview surfaces move.** Global Payouts is in public preview; its exact
  request shapes and event names may change. Pinning the whole app's SDK to a
  preview channel couples stable flows to an unstable one.
- **Config must not brick boot.** CI auto-applies on merge to `main`. A
  hard-required env var that isn't yet seeded in Secrets/SSM would fail config
  parsing at boot and take the API down on deploy.

## Options considered

1. **rawRequest on an isolated, preview-pinned client** (chosen). One small
   wrapper owns every preview call; the rest of the app keeps the stable SDK.
2. **Bump `stripe` to a preview SDK channel.** Gives typed
   `v2.moneyManagement.*` resources, but re-pins the default wire format for
   _all_ Stripe usage and ties stable flows to a preview release.
3. **A second `stripe` dependency at a different version.** Avoids re-pinning
   the shared client but doubles the dependency, risks duplicate-instance
   pitfalls, and bloats the bundle for a handful of endpoints.

## Rationale

- **Blast radius of one file.** Every preview-specific call is in `payouts.ts`.
  If the preview API changes, that is the only thing to update; donations and
  membership are unaffected.
- **No dependency churn.** No SDK bump, so no risk to the v1 flows and no
  lockfile surprises (per the `feedback_careful_installs` rule).
- **Typed where it is stable, raw where it is not.** `rawRequest` returns
  `Promise<any>` which we narrow behind a small typed `PayoutsClient`
  interface, so callers stay type-safe without unsafe casts.
- **Fails safe, not loud.** Null-when-unconfigured + placeholder-tolerant
  config means a deploy before provisioning boots fine and the payout endpoint
  returns a clear "not configured" error, rather than bricking the API. This
  deliberately diverges from the usual "new env vars are required, not
  optional" rule (`feedback_required_env_vars`) because the auto-apply-on-merge
  pipeline makes a hard-required-but-unprovisioned var a boot hazard; enabling
  payouts later means seeding the values and wiring them as SSM params (mirror
  `VAPID_PUBLIC_KEY`).

## Rejected alternatives

- **SDK bump to a preview channel** - rejected: re-pins the wire format for all
  Stripe usage and couples money-moving v1 flows to an unstable preview
  release for no benefit beyond typed resources we can wrap ourselves.
- **Second pinned `stripe` dependency** - rejected: duplicate dependency and
  instance for a handful of endpoints; the isolated rawRequest client achieves
  the same isolation with less weight.

## Related

- Client + event mapper: `apps/api/src/features/expense/payouts.ts`.
- Raw-body webhook handling mirrors [ADR 007](007-webhook-raw-body.md) but on a
  separate endpoint (`/api/stripe/payouts-webhook`) with its own signing secret.
- Residual items to verify against the live preview account (exact version
  string, event names, recipient `requirements`) are tracked in `EXPENSES.md`.
