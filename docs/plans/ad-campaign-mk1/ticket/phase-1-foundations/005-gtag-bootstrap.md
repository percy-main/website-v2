# 005 — `gtag.js` bootstrap + `trackEvent` wrapper

**Phase**: 1 — Foundations
**Depends on**: 004
**Effort**: S

## Context

Pattern A Consent Mode v2: the inline stub queues `gtag('consent','default', { …denied, wait_for_update: 500 })` before `gtag.js` loads. Both live in `index.html` so they run on every page regardless of route.

## Scope

### In

- Inline stub in `apps/web/index.html` — defines `window.dataLayer`, `gtag()`, queues the default denied consent with `wait_for_update: 500`.
- Async `<script src="https://www.googletagmanager.com/gtag/js?id=%VITE_GA4_MEASUREMENT_ID%">` tag, followed by inline `gtag('js', …)` and `gtag('config', …)` for GA4 + Ads conversion ID.
- Vite HTML transform (or template substitution) that **omits** the gtag tags entirely when `VITE_GA4_MEASUREMENT_ID` or `VITE_GOOGLE_ADS_CONVERSION_ID` env vars are absent — keeps local dev clean.
- `apps/web/src/lib/marketing/gtag.ts`:
  - `trackEvent(name: string, params?: Record<string, unknown>): void` — `window.gtag?.('event', name, params)`. No consent gate inside this function — Consent Mode handles it.
  - Types for `window.gtag` + `window.dataLayer` added to `apps/web/src/types/`.
- Basic `sha256(input: string): Promise<string>` helper for Enhanced Conversions (SubtleCrypto, hex digest). Used in ticket 402.

### Out

- Calling `trackEvent` anywhere (that's Phase 3).
- Any env-var configuration — just consume what's there.

## Approach

- Stub must be inline and synchronous, before the async gtag script tag, so the default consent state is set before any tag fires.
- Vite env vars are substituted at build time via the `%VITE_*%` placeholder pattern (already in use) or a small HTML transform plugin.
- Verify the stub runs ~0 ms; don't accidentally serialise it.

## References

- [CONVERSION_TRACKING.md §8 Consent Mode v2](../../CONVERSION_TRACKING.md#8-consent-consent-mode-v2)
- [CONVERSION_TRACKING.md §10 Online conversions (gtag.js)](../../CONVERSION_TRACKING.md#10-online-conversions-gtagjs)

## Acceptance

- [ ] Fresh visit with `VITE_GA4_MEASUREMENT_ID` set: devtools shows `gtag.js` loaded, `dataLayer` has `consent`/`default`/denied record, network shows cookieless ping.
- [ ] Fresh visit without env var: no `gtag.js` request.
- [ ] After Allow, `gtag('consent','update', ...)` visible in DataLayer; subsequent calls can write cookies.
- [ ] `trackEvent('ping', {})` during dev session pushes to `dataLayer` without error.
- [ ] `pnpm -w run lint` / `typecheck` / build pass.
