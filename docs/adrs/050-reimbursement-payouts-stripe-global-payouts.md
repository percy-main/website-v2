# ADR 050: Reimbursement payouts via Stripe Global Payouts, with Stripe holding payee bank details

## Status

Accepted

## Context

The club needs to reimburse volunteers' out-of-pocket expenses (fuel, umpires'
fees, kit) through an audited submit -> approve -> pay workflow (see
`EXPENSES.md`). Step four, "pay the claimant", moves money from the club to an
individual's personal bank account. That raised two coupled questions:

1. **Which rail moves the money?** The club already uses Stripe to _take_
   payments (donations, membership, match fees), so reaching for Stripe was
   natural - but Stripe "Payouts" (the product) only pays the platform's _own_
   bank account, not third parties.
2. **Where do the payee's bank details live?** Sort code + account number are
   personal data. The brief explicitly preferred a design where the club never
   stores them.

## Decision

Pay claimants via **Stripe Global Payouts** (recipients + OutboundPayments on
the v2 money-movement API), funded from a Stripe-managed Financial Account that
draws on the club's existing GBP payments balance.

The payee's bank details are **collected and held by Stripe**, not by us. On
first payout we create a Global Payouts recipient and hand the claimant a
Stripe-hosted setup link to enter their bank account directly into Stripe. We
persist only opaque references on the `expense` row -
`stripe_recipient_account_id`, `stripe_payout_method_id`,
`stripe_outbound_payment_id` - never the sort code or account number.

A manual "mark paid" path (treasurer pays by bank transfer, records it) is kept
as a permanent fallback for when payouts aren't configured or a payout fails.

## Problem

Three constraints shaped the call:

- **Recipients are arbitrary individuals, not marketplace sellers.** They have
  no ongoing relationship with a platform; asking each to complete full
  marketplace onboarding would be disproportionate for a community club paying
  the odd £20 fuel claim.
- **Data-protection exposure should be minimised.** Holding bank details
  ourselves pulls in encryption-at-rest, a retention schedule, tightened
  access control, and breach liability - all for data we only need at the
  moment of payment.
- **Funds already sit in Stripe.** Membership and donations settle to the
  club's Stripe balance, so a Stripe-native payout avoids a separate bank
  integration and reuses money already on hand.

## Options considered

1. **Stripe Global Payouts** (chosen). Pay third parties who hold no Stripe
   account; Stripe stores their payout method. UK GBP domestic payouts cost
   ~£0.50 each, no monthly fee.
2. **Stripe Connect** (Accounts v2, transfers/payouts). The full marketplace
   product. Each payee becomes a connected account with its own onboarding and
   KYC surface - heavier than the use case warrants, and still ends with Stripe
   holding the bank details, so no data-minimisation gain over Global Payouts.
3. **Collect bank details ourselves, pay via any rail.** Simplest to reason
   about, worst on data protection: we would store account numbers and own the
   compliance burden. Rejected.
4. **App tracks the workflow only; treasurer pays manually.** Zero payment-data
   liability and zero new Stripe product, but no one-click payout. Kept as the
   fallback rather than the primary rail.

## Rationale

- **Right-sized for the payee.** Global Payouts recipients are lightweight: a
  name, an email, and bank details the claimant enters once into Stripe and
  reuses on later claims.
- **Data minimisation by construction.** Because Stripe holds the payout
  method, the club's database contains no bank details - only token ids. This
  is the outcome the brief asked for, achieved without bespoke encryption or a
  retention policy on our side.
- **Reuses existing funds + account.** Payouts draw on the balance donations
  and membership already top up; no second banking integration.
- **Idempotent and auditable.** A unique `stripe_outbound_payment_id` plus the
  append-only `expense_event` log guarantee a claim is never paid twice and
  every transition is recorded - matching the workflow's audit requirement.

## Rejected alternatives

- **Stripe Connect** - rejected as disproportionate: full connected-account
  onboarding/KYC per volunteer for small reimbursements, with no
  data-protection advantage over Global Payouts.
- **Storing bank details ourselves** - rejected on data-minimisation grounds;
  it would make the club the custodian of personal financial data it only
  transiently needs.
- **Manual-only** - not rejected, but demoted to the fallback path; the goal is
  one-click payout once the Financial Account is provisioned.

## Related

- Global Payouts is on Stripe's preview v2 API; how we call it without an SDK
  bump is [ADR 051](051-stripe-global-payouts-raw-request-isolation.md).
- Implementation: `apps/api/src/features/expense/` (`payouts.ts`, `service.ts`).
- The legal/retention sign-off and the treasurer's preference are tracked in
  `EXPENSES.md` (decisions 13.1, 13.2). Licensing/legal positions remain
  Alex's call; this ADR records the engineering decision, not a legal opinion.
