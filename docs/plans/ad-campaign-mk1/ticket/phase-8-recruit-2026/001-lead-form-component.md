# 001 — `<LeadForm>` component + post-submit success state

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: phase-2-lead-capture/002
**Effort**: M

## Context

The reusable form component every landing page renders. Handles adult vs junior field sets, honeypot, submission, and the personalised inline success state (no confirmation email per campaign design).

## Scope

### In

- `apps/web/src/components/marketing/lead-form.tsx`:
  - Props: `{ campaignId, segment, variant?: 'adult' | 'junior' }`.
  - Variant `'adult'` renders: Name, Email, Phone (optional), Notes (optional).
  - Variant `'junior'` renders: Child's name, Parent name, Parent email, Parent phone (optional), Notes (optional).
  - Hidden honeypot field.
  - Attribution + consent snapshot attached from `pm_attrib` + `pm_consent` on submit.
  - Calls `callApi(api.POST('/api/marketing/leads', ...))`.
  - On success: replaces itself with the personalised success state (copy from [`RECRUIT_CAMPAIGN.md` §5 Post-submit state](../../RECRUIT_CAMPAIGN.md#5-trial-form-fields)):
    - Adults: `Thanks {name} — someone from Percy Main will be in touch within 1 working day. If you haven't heard from us by then, please email trustees@percymain.org.`
    - Juniors: `Thanks — we'll be in touch about {child_name}'s trial within 1 working day. If you haven't heard from us by then, please email trustees@percymain.org.`
  - Fires `trackEvent('generate_lead', …)` only after the API call returns 200 (including Enhanced Conversions attachment from phase-4/002).
- `apps/web/src/components/marketing/segment-picker.tsx`: small `<select>` used by the `/tell-me-about` fallback page (ticket 006).

### Out

- The actual landing pages (tickets 002–006).

## Approach

- Use shadcn form components (Label/Input/Textarea) to match the rest of the site.
- Keep the component pure-presentational + a single submit handler; no routing logic inside.

## References

- [RECRUIT_CAMPAIGN.md §5 Trial form fields](../../RECRUIT_CAMPAIGN.md#5-trial-form-fields)
- [CONVERSION_TRACKING.md §9 POST /api/marketing/leads](../../CONVERSION_TRACKING.md#9-public-api-surface)

## Acceptance

- [ ] Adult variant renders 4 fields + honeypot.
- [ ] Junior variant renders 5 fields + honeypot.
- [ ] Successful submit replaces the form with the personalised message, uses the user's entered name.
- [ ] `trackEvent('generate_lead')` fires with Enhanced Conversions gated on consent.
- [ ] Failing submit shows a retry-able error, does not fire `trackEvent`.
