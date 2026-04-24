# 002 — Shared marketing primitives

**Phase**: 1 — Foundations
**Depends on**: 001
**Effort**: M

## Context

Typed contracts shared between API, web, and tests. No behaviour — just types, Zod schemas, and the campaign registry. Keeps drift impossible once downstream code starts using them.

## Scope

### In

- `packages/shared/src/marketing/attribution.ts` — `Attribution` type + Zod schema (includes `experiment_id`, `variant`).
- `packages/shared/src/marketing/events.ts` — `marketingEventType` Zod enum (`generate_lead`, `contact_form_submitted`, `sign_up`, `begin_checkout`, `purchase`, `lead_contacted`, `lead_attended_session`, `lead_became_member`).
- `packages/shared/src/marketing/campaigns.ts` — campaign registry as a `const` object. Includes the type-level `AssertAllSegmentsHavePrimaryAction` guard. Start with `recruit-2026` entry populated with placeholder conversion-action resource names (`customers/0/conversionActions/…`) — real names land in Phase 4.
- `packages/shared/src/marketing/schemas.ts` — `marketingLeadSchema` with structured `consent` object; `leadOutcomeSchema` for admin actions.
- `packages/shared/src/marketing/consent.ts` — `ConsentRecord` type + Zod schema.
- Barrel export from `packages/shared/src/marketing/index.ts`.

### Out

- Any routes that use these schemas.
- Actual conversion-action IDs from Google Ads.

## Approach

- Plain TypeScript + Zod. No runtime dependencies beyond what `packages/shared` already has.
- Campaign registry is `as const` so keys are narrowed at compile time.
- Type-level guard uses conditional types — see the example in `CONVERSION_TRACKING.md` §6.

## References

- [CONVERSION_TRACKING.md §6 Campaign registry](../../CONVERSION_TRACKING.md#6-campaign-registry)
- [CONVERSION_TRACKING.md §7 Attribution capture](../../CONVERSION_TRACKING.md#7-attribution-capture-browser)
- [CONVERSION_TRACKING.md §9 Public API surface](../../CONVERSION_TRACKING.md#9-public-api-surface)

## Acceptance

- [ ] `pnpm -w run typecheck` passes.
- [ ] Type-level guard fails to compile if a `recruit-2026` segment is dropped from the `conversionActions.generate_lead` map (verified by temporarily deleting one and confirming the error).
- [ ] All types importable from `@percy-main/shared/marketing`.
