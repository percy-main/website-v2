# 003 — Attribution cookie helper

**Phase**: 1 — Foundations
**Depends on**: 002
**Effort**: S

## Context

Captures `gclid`, UTMs, referrer, and landing path on first touch and persists them in a first-party cookie so later form submissions can attach acquisition context.

## Scope

### In

- `apps/web/src/lib/marketing/attribution.ts`:
  - `readAttribution(): Attribution | null` — parse cookie.
  - `maybeCaptureAttribution()` — on page load, if URL carries any of `gclid`/`gbraid`/`wbraid`/`utm_*`, write cookie. First-touch wins; do not overwrite.
  - Writing is gated on `getConsent().ad_storage === 'granted'` (comes from ticket 004).
- Wire `maybeCaptureAttribution()` into the app bootstrap (e.g. a top-level effect in `RootLayout` or `main.tsx`) so it runs on any landing.
- Unit tests: URL-with-params → cookie written; URL without params → no cookie; cookie already present → no overwrite; consent denied → no cookie.

### Out

- Experiment variant assignment (plumbed through as a pass-through field, not generated here).
- Any UI.

## Approach

- Cookie: `pm_attrib`, 90-day expiry, `SameSite=Lax`, `Secure`, JSON payload, 1.5 KB hard cap (truncate `referrer` if needed).
- Use `document.cookie` directly or a tiny helper; no new dependency.
- Attribution shape from `@percy-main/shared/marketing` — do not redefine.

## References

- [CONVERSION_TRACKING.md §7 Attribution capture](../../CONVERSION_TRACKING.md#7-attribution-capture-browser)

## Acceptance

- [ ] Visiting `/?gclid=abc&utm_source=google&utm_campaign=recruit-2026` after consent sets `pm_attrib`.
- [ ] Second visit with different UTMs does not overwrite.
- [ ] Unit tests pass.
- [ ] `pnpm -w run typecheck` and `lint` pass.
