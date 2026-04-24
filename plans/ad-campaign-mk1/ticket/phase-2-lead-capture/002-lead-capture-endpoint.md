# 002 — `POST /api/marketing/leads` endpoint

**Phase**: 2 — Lead capture + admin
**Depends on**: 001
**Effort**: M

## Context

The one public endpoint every campaign's lead form submits to. Unauthenticated, rate-limited, honeypot-protected. No generic `/events` endpoint — we don't want the public writing arbitrary event types.

## Scope

### In

- `apps/api/src/features/marketing/{routes,schemas,service}.ts` per the `add-endpoint` skill convention.
- `POST /api/marketing/leads`:
  - Zod body: `marketingLeadSchema` from `@percy-main/shared/marketing`.
  - Validates `campaignId` against the registry — unknown → 400.
  - Calls `emitMarketingEvent` with `type: 'generate_lead'`, consent fields from the body.
  - Fire-and-forget: Slack notification + SES confirmation email (Slack follows the existing `contact/service.ts` pattern).
  - Response: `{ leadId: string }`.
- Honeypot field (invisible input — real submissions leave it empty).
- Rate limit: per-IP + per-email, e.g. 5 submissions / 10 min. Use existing Fastify rate-limit plugin if configured; otherwise a lightweight in-memory counter is acceptable at this volume.
- Regenerate OpenAPI types: `pnpm run openapi:generate`.
- Integration test (`add-migration`-style testcontainers): full happy path end-to-end.

### Out

- The form component itself (Phase 8).
- Consent banner / gtag firing from the form (that lives in the web app).

## Approach

- Follow `add-endpoint` skill. Curried service factory wired in `routes.ts`.
- Confirmation email template via `packages/email`; minimal — use existing patterns (ChargeNotification is a reference).
- Slack message: name, email, segment, campaign, first line of notes, admin-panel deep link.

## References

- [CONVERSION_TRACKING.md §9 Public API surface](../../CONVERSION_TRACKING.md#9-public-api-surface)
- [RECRUIT_CAMPAIGN.md §5 Trial form fields](../../RECRUIT_CAMPAIGN.md#5-trial-form-fields)
- [RECRUIT_CAMPAIGN.md §6 Lead response workflow](../../RECRUIT_CAMPAIGN.md#6-lead-response-workflow)

## Acceptance

- [ ] Valid submission returns 200 + leadId; DB has lead + marketing_event + outbox rows.
- [ ] Unknown campaignId returns 400.
- [ ] Honeypot-filled submission returns 200 (silent) with no DB writes.
- [ ] Rate-limited IP gets 429.
- [ ] Generated OpenAPI types include the new endpoint.
- [ ] Integration test passes (testcontainers).
