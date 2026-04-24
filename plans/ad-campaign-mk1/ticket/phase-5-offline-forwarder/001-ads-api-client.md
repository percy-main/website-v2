# 001 — Google Ads API client adapter

**Phase**: 5 — Offline forwarder + outcome uploads
**Depends on**: phase-4-ads-online/001 (Secrets Manager creds must exist)
**Effort**: M

## Context

A thin, testable wrapper around the Google Ads API Node SDK for uploading offline conversions. No business logic; just auth + call + typed error translation.

## Scope

### In

- Add `google-ads-api` (or official `google-ads-nodejs-client`) as a dependency of `apps/api`. Pin a specific version.
- `apps/api/src/features/marketing/ads-client.ts`:
  - `createAdsClient(config)` — constructs an authenticated client using developer token, customer ID, OAuth2 client ID + secret + refresh token from `app.config`.
  - `uploadClickConversions(clickConversions: ClickConversion[])` method.
  - Error translation: validation errors → typed `AdsValidationError` (non-retryable); rate-limit/5xx/network → `AdsTransientError` (retryable).
- Extend `apps/api/src/config.ts` Zod schema with the new `GOOGLE_ADS_*` env vars (already enumerated in `CONVERSION_TRACKING.md` §15). Source the service-account / OAuth values from Secrets Manager via the existing pattern.
- Feature-flag via env: if `GOOGLE_ADS_DEVELOPER_TOKEN` is unset, `createAdsClient()` returns a no-op stub (keeps local dev clean).

### Out

- The forwarder loop that calls this (ticket 002).
- Business logic around what to upload (ticket 003).

## Approach

- Prefer the official Google client (`google-ads-nodejs-client`) if its TypeScript types are usable; fall back to `google-ads-api` if easier.
- Integration test with `nock` or the SDK's built-in mock, not a real API call.

## References

- [CONVERSION_TRACKING.md §11 Offline conversion forwarder](../../CONVERSION_TRACKING.md#11-offline-conversion-forwarder)
- [CONVERSION_TRACKING.md §15 Config additions](../../CONVERSION_TRACKING.md#15-config-additions-appsapisrcconfigts)

## Acceptance

- [ ] `createAdsClient` authenticates against a real sandbox or test manager account.
- [ ] Validation errors are typed; a bad conversion action surfaces as `AdsValidationError`.
- [ ] Client is a no-op when env vars are missing.
- [ ] `pnpm -w run typecheck` / `lint` pass.
