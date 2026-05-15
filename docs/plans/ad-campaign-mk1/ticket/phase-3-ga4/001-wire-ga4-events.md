# 001 — Wire GA4 measurement ID + fire events

**Phase**: 3 — GA4 via gtag.js, no Ads
**Depends on**: phase-1-foundations/005, phase-2-lead-capture/002
**Effort**: S

## Context

Turn on GA4 (no Ads yet). Add a GA4 property, wire the measurement ID, and fire the three events we care about from the browser: `generate_lead`, `purchase`, `sign_up`. Consent Mode v2 already handles denied/granted transparently.

## Scope

### In

- Create a new GA4 property in the existing `alex.young@percymain.org` Google Workspace account. Record the measurement ID.
- Set `VITE_GA4_MEASUREMENT_ID` in `.env` / GH Actions secrets / ECS task definition.
- `apps/web/src/pages/tell-me-about/*` form submit handler (or the `<LeadForm>` component from Phase 8): after successful POST, call `trackEvent('generate_lead', { campaign_id, segment })`. (Enhanced Conversions details land in Phase 4.)
- `apps/web/src/pages/auth/register.tsx` (or the equivalent auth callback): `trackEvent('sign_up', { method: 'email' })` once registration succeeds.
- `apps/web/src/pages/payment/confirm.tsx`: `trackEvent('purchase', { value, currency: 'GBP' })` when Stripe redirects back with a success status.
- No Ads conversion ID yet — `send_to` omitted.

### Out

- Ads conversion firing (Phase 4).
- Server-side Measurement Protocol (not needed; gtag covers it).

## Approach

- `trackEvent` comes from `apps/web/src/lib/marketing/gtag.ts` (ticket phase-1/005).
- GA4 property setup is UI-only work — document in the commit message.

## References

- [CONVERSION_TRACKING.md §19 Phase 3](../../CONVERSION_TRACKING.md#19-rollout-plan)
- [CONVERSION_TRACKING.md §10 Online conversions](../../CONVERSION_TRACKING.md#10-online-conversions-gtagjs)

## Acceptance

- [ ] GA4 property exists; measurement ID in config.
- [ ] Submitting a test lead produces a `generate_lead` event in GA4 DebugView within ~1 min.
- [ ] Registering produces `sign_up`; completing a Stripe payment produces `purchase`.
- [ ] Declining consent on the banner suppresses user-identifying fields but events still reach GA4 (Consent Mode v2 cookieless pings).
