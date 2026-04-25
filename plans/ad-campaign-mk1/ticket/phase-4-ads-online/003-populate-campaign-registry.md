# 003 — Populate `recruit-2026` conversion actions in the registry

**Phase**: 4 — Ads online conversions, soft launch
**Depends on**: 001
**Effort**: XS

## Context

Simple PR: replace the `customers/X/conversionActions/…` placeholders with real resource names + conversion labels from ops ticket 001.

## Scope

### In

- Edit `packages/shared/src/marketing/campaigns.ts` with the six real `conversionActions` entries:
  - 4 × `generate_lead` (per segment) — resource name + conversion label.
  - `lead_attended_session`: `_all: { resourceName, conversionLabel }`.
  - `lead_became_member`: `_all: { resourceName, conversionLabel }`.
- Confirm the compile-time `AssertAllSegmentsHavePrimaryAction` guard still passes.

### Out

- Any code behaviour change.

## Approach

- One-file PR. Keep the registry as typed `as const` so type-level checks catch typos.

## References

- [CONVERSION_TRACKING.md §6 Campaign registry](../../CONVERSION_TRACKING.md#6-campaign-registry)

## Acceptance

- [ ] `pnpm -w run typecheck` passes.
- [ ] Values match what appears in the Google Ads UI under Tools → Conversions.
