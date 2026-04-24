# 003 — `ClickConversion` payload builder (consent-aware)

**Phase**: 5 — Offline forwarder + outcome uploads
**Depends on**: 001, 002
**Effort**: M

## Context

Translates a `marketing_event` + its `lead` into the `ClickConversion` shape the Ads API expects. Consent- and attribution-aware: the matrix in `CONVERSION_TRACKING.md` §11 is the spec.

## Scope

### In

- `apps/api/src/features/marketing/build-click-conversion.ts`:
  - Input: `{ event, lead }` loaded by the drain loop.
  - Output: `ClickConversion | null` (null = skip upload, update outbox row to `succeeded` with reason `skipped_no_match`).
  - Logic:
    - Resolve `conversion_action` resource name from the event.
    - Set `conversion_date_time`, `order_id: event.id`, `conversion_value`, `currency_code`.
    - Attach `gclid` from `lead.attribution.gclid` if present.
    - Attach `user_identifiers` (hashed email SHA-256, lowercased/trimmed) **only if** `lead.consent_ad_user_data === 'granted'`.
    - Set the `consent` object:
      - `ad_user_data: lead.consent_ad_user_data` mapped to GRANTED / DENIED / UNSPECIFIED.
      - `ad_personalization` mirrors `ad_user_data` (we don't track this as a separate axis).
    - If neither `gclid` nor (`ad_user_data === 'granted'` + email) is available → return `null`.
  - Per-lead cutoff check: if `min(conversionActionWindow, 63 days) < now() - lead.attribution.first_seen_at`, return `null` (past attribution window — do not upload).
- Unit tests covering every row of the consent matrix in [§11](../../CONVERSION_TRACKING.md#11-offline-conversion-forwarder).

### Out

- Where/when this is called (that's the drain loop).

## Approach

- Pure function — no DB, no SDK. Easy to test.
- SHA-256 helper: use `node:crypto` on the server side (distinct from the SubtleCrypto used on the web).

## References

- [CONVERSION_TRACKING.md §11 What it sends + Consent-driven behaviour matrix](../../CONVERSION_TRACKING.md#11-offline-conversion-forwarder)

## Acceptance

- [ ] All six matrix rows have a passing unit test.
- [ ] Past-window event returns null.
- [ ] Event with no `gclid` and denied `ad_user_data` returns null.
- [ ] Event with both gclid + granted returns the full payload including hashed email + Consent=granted.
