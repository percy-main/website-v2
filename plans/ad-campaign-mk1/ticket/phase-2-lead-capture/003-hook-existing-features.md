# 003 — Hook existing contact form + Stripe webhook

**Phase**: 2 — Lead capture + admin
**Depends on**: 001
**Effort**: S

## Context

Two existing features produce funnel-relevant data today but don't emit `marketing_event`s. Hook them so reporting is unified and downstream Ads offline conversions can track members back to their original campaign.

## Scope

### In

- **`apps/api/src/features/contact/service.ts`** — on successful submission:
  - Call `emitMarketingEvent` with `type: 'contact_form_submitted'`.
  - If the body contained `campaignId`/`segment`/`attribution` (coming from a campaign-linked contact form), also create a `lead` via the same call.
  - Preserve existing Slack notification; do not regress.
- **`apps/api/src/features/payments/webhook-service.ts`** — on `checkout.session.completed`:
  - Best-effort email-match against `lead` (case-insensitive).
  - If matched, set `lead.member_id` and emit `lead_became_member` with value from the campaign registry (£50 flat for `recruit-2026`).
  - Always emit `purchase` event with the Stripe amount — reporting only, not an Ads conversion by default.
  - Wrap all marketing writes in try/catch; webhook success must not depend on marketing writes succeeding.

### Out

- Any new endpoints or admin surface.

## Approach

- Same curried-factory pattern. `emitMarketingEvent` is injected where needed, not called at module level.
- For the contact form: the existing `ContactSubmission` schema stays; optional `campaignId`/`segment`/`attribution` can be added as non-breaking additions to the body.
- Unit-test the Stripe webhook branches: match hit, match miss, marketing write throws (webhook still succeeds).

## References

- [CONVERSION_TRACKING.md §9 Hooked into existing features](../../CONVERSION_TRACKING.md#9-public-api-surface)
- [CONVERSION_TRACKING.md §18 Trade-offs (Stripe webhook coupling)](../../CONVERSION_TRACKING.md#18-trade-offs-and-risks)

## Acceptance

- [ ] Contact form submission writes a `contact_form_submitted` event.
- [ ] `checkout.session.completed` webhook writes `purchase` + (if matched) `lead_became_member` with £50 value; sets `lead.member_id`.
- [ ] Simulated marketing-write failure does not cause webhook to return non-200.
- [ ] Existing tests still pass.
