# 004 — Consent record + banner component

**Phase**: 1 — Foundations
**Depends on**: 002
**Effort**: M

## Context

The whole consent mechanism in one ticket: the `ConsentRecord` storage, the banner UI, and the Consent Mode v2 `gtag('consent', 'update', …)` calls on accept/decline. Pattern A (Full Consent Mode v2): `gtag.js` is always loaded (ticket 005); this ticket just sets consent state.

## Scope

### In

- `apps/web/src/lib/marketing/consent.ts`:
  - `getConsent(): ConsentRecord | null` — read `pm_consent` cookie (JSON).
  - `setConsent(state, source)` — write record with current `version`, ISO timestamp; call `gtag('consent','update', ...)` for all four axes.
  - `needsConsent(): boolean` — true when no record, or record `version` < current.
  - `CURRENT_CONSENT_VERSION` constant — bump on privacy-notice change.
- `apps/web/src/components/consent-banner.tsx`:
  - Fixed bottom bar, full-width on mobile, stacked content + buttons.
  - Not modal, not blocking, keyboard-navigable, screen-reader-labelled.
  - Copy: the exact string in [CONVERSION_TRACKING.md §8 Banner UX](../../CONVERSION_TRACKING.md#8-consent-consent-mode-v2).
  - "Allow" uses primary green; "Decline" neutral grey; equal size.
  - Privacy link to `/legal/privacy`.
- Mount `<ConsentBanner />` in `RootLayout` (or equivalent); render only if `needsConsent()`.
- On mount (regardless of banner), if a valid record exists, issue the matching `gtag('consent','update', …)` inside the 500 ms `wait_for_update` window.
- Reserve ~72 px of `padding-bottom` on the page container while the banner is visible — no CLS.

### Out

- `gtag.js` loading itself (ticket 005).
- Footer "Cookie settings" link / re-open flow (ticket 006).
- Per-vendor toggles, IAB TCF, GPP.

## Approach

- Cookie: `pm_consent`, 12-month expiry, `SameSite=Lax`, `Secure`, JSON-encoded `ConsentRecord`.
- Banner implementation: plain React + Tailwind; no headless-UI dialog (not modal).
- Unit tests: cookie round-trip; `needsConsent()` true on version bump; button clicks write record with correct `source`.

## References

- [CONVERSION_TRACKING.md §8 Consent (Consent Mode v2)](../../CONVERSION_TRACKING.md#8-consent-consent-mode-v2)

## Acceptance

- [ ] Fresh visit shows the banner.
- [ ] Clicking Allow writes `pm_consent` with `state: "granted"`, current version, ISO timestamp, `source: "banner"`, and issues `gtag('consent','update', ...)` with all four axes granted.
- [ ] Clicking Decline does the same with denied state.
- [ ] On subsequent page load, banner does not appear; `gtag('consent','update', ...)` fires inside 500 ms.
- [ ] Bumping `CURRENT_CONSENT_VERSION` re-shows the banner.
- [ ] Lighthouse: no CLS introduced.
