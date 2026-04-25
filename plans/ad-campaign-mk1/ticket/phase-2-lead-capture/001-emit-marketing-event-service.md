# 001 — `emitMarketingEvent` shared service

**Phase**: 2 — Lead capture + admin
**Depends on**: phase-1-foundations/001, 002
**Effort**: M

## Context

The single write path for every `marketing_event` row. Called from the public lead endpoint, the admin outcome endpoint, the existing contact route, and the Stripe webhook. Handles lead upsert, event insert, and outbox enqueue in one transaction.

## Scope

### In

- `apps/api/src/features/marketing/service.ts`:
  - `emitMarketingEvent(db)` curried factory.
  - Arguments: `{ type, lead?, campaignId?, segment?, attribution?, value?, payload?, source, createdBy? }`.
  - Behaviour:
    1. Resolve `ads_conversion_action` from the campaign registry.
    2. If `lead` provided by email/phone/name, upsert (match on email, set `first_campaign_id` only if null, freeze consent columns on first-time insert).
    3. Insert `marketing_event` row.
    4. If event type has an `ads_conversion_action`, insert `marketing_outbox(destination='google_ads', status='pending')`.
    5. All in one Kysely transaction.
  - Return: `{ leadId?, eventId }`.
- Unit tests covering: new lead, existing lead (email match), consent freeze, campaign resolution miss (no outbox), outbox row created when action resolves.

### Out

- Routes that call it (later tickets in this phase).
- The forwarder that drains the outbox (Phase 5).

## Approach

- Follow the curried-factory service pattern from the rest of the API.
- Reuse the registry resolver from `packages/shared/src/marketing/campaigns.ts` — do not duplicate.
- Transaction: `db.transaction().execute(async trx => { … })`.

## References

- [CONVERSION_TRACKING.md §4 Database schema](../../CONVERSION_TRACKING.md#4-database-schema)
- [CONVERSION_TRACKING.md §6 Campaign registry](../../CONVERSION_TRACKING.md#6-campaign-registry)
- [CLAUDE.md functional DI + service factory convention](../../../../.claude/CLAUDE.md)

## Acceptance

- [ ] Unit tests pass.
- [ ] New lead with `generate_lead` type + `recruit-2026` campaign writes one lead row, one marketing_event row with the resolved conversion action, one marketing_outbox row.
- [ ] Second call with same email reuses the lead and does not change `first_campaign_id`.
- [ ] No outbox row for event types with no mapped conversion action.
