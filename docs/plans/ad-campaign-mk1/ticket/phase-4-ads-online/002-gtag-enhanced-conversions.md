# 002 — Wire Ads conversion ID + Enhanced Conversions in `gtag`

**Phase**: 4 — Ads online conversions, soft launch
**Depends on**: 001, phase-3-ga4/001
**Effort**: S

## Context

Start firing `generate_lead` to Google Ads with `send_to` and Enhanced Conversions hashed email. The email attachment is gated on `ad_user_data` consent per the consent matrix.

## Scope

### In

- Set `VITE_GOOGLE_ADS_CONVERSION_ID` build env var (from ops ticket 001).
- Extend `apps/web/src/pages/tell-me-about/*` (or the shared `<LeadForm>`) submit handler:
  - After successful POST, call `trackEvent('generate_lead', params)` where `params` includes:
    - `campaign_id`, `segment`
    - `send_to: ${ADS_CONVERSION_ID}/${conversionLabel}` — `conversionLabel` resolved per-segment from the campaign registry.
    - `value: 0`, `currency: 'GBP'`.
    - `user_data: { email_address: sha256(email.toLowerCase().trim()) }` — only attached when `getConsent().ad_user_data === 'granted'`.
- Use the `sha256` helper from ticket phase-1-foundations/005.
- Update `packages/shared/src/marketing/campaigns.ts` to add a per-segment `conversionLabel` field (the short tag Google embeds in `send_to`) alongside the full resource name.

### Out

- Offline conversion uploads (Phase 5).
- Registry update with real conversion actions (ticket 003 — populates both `conversionLabel` and resource name).

## Approach

- Regenerate OpenAPI types after any Zod schema change (shouldn't be needed here, but run `pnpm run openapi:generate` if touched).
- Add a tiny unit test that the submit handler calls `trackEvent` with `user_data` present when granted, absent when denied.

## References

- [CONVERSION_TRACKING.md §10 Firing (consent-gated user_data)](../../CONVERSION_TRACKING.md#10-online-conversions-gtagjs)
- [ADS_REVIEW.md Finding 4](../../ADS_REVIEW.md)

## Acceptance

- [ ] Granted-consent submission: `gtag` event payload has `send_to` and `user_data.email_address` (hashed).
- [ ] Denied-consent submission: `gtag` event payload has `send_to` but no `user_data`.
- [ ] Ads UI "Conversions" → "Diagnostics" shows the conversion being received for `generate_lead`.
