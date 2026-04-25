# Marketing pipeline runbook

Operational reference for the conversion-tracking pipeline introduced
in `plans/ad-campaign-mk1/`. Aimed at the on-call admin (Alex).

## Architecture at a glance

```
browser  ─ POST /api/marketing/leads ─►  emitMarketingEvent  ─► DB (lead, marketing_event, marketing_outbox)
admin UI ─ POST /api/admin/leads/:id/outcomes ─► same path
Stripe   ─ webhook  ─► emitMarketingEvent (purchase + lead_became_member)

Fastify forwarder plugin
   ↓ every 30s
   ↓ SELECT FOR UPDATE OF marketing_outbox SKIP LOCKED LIMIT 20
   ↓ buildClickConversion (consent + attribution gate)
   ↓ Google Ads uploadClickConversions (via google-ads-api)
   ↓ status transitions: pending → succeeded | dead | retried
```

## Where things live

- API code: `apps/api/src/features/marketing/`
- Web admin: `apps/web/src/pages/admin/leads-tab.tsx` and
  `marketing-outbox-tab.tsx` (deep-linked, `?tab=marketing-outbox`)
- Shared types + campaign registry: `@percy-main/shared/marketing`
- Per-lead Ads cutoff: precomputed by the API into
  `adsCutoffAt` and surfaced under the Created column

## Daily checks

1. Open Admin → Leads. Confirm new lead volume looks reasonable
   compared to the last 7 days.
2. Open Admin → `?tab=marketing-outbox`, filter status=`pending`. Should
   normally be < a handful (drain runs every 30s).
3. Same view, status=`dead`. **Should be 0**. Anything here needs
   attention — see "Dead-letter triage" below.
4. Spot-check Slack `#new-leads` against the Leads tab to make sure
   nothing is being silently dropped.

## Dead-letter triage

A `dead` row means the upload failed terminally, either:

1. **Validation error** — Google Ads rejected the payload outright
   (bad conversion action, malformed gclid, past attribution window we
   didn't catch, etc.).
2. **Transient error that exhausted all 6 retry attempts** — usually
   only happens during sustained Ads API outages.

Steps:

- Open the row, read `last_error`. The message comes straight from the
  Google Ads SDK — paste into the Ads error reference if not obvious.
- For validation errors, check:
  - `marketing_event.ads_conversion_action` matches the resource name
    you can see in Ads UI → Tools → Conversions.
  - Lead's `attribution.first_seen_at` is inside the configured
    window. If past-window slipped through (shouldn't with the
    builder check), file an issue.
- For transient exhaustion, hit "Retry" once. If it fails again,
  check Ads API status (https://status.cloud.google.com/) before
  escalating.

## Manual replay

Admin → `?tab=marketing-outbox` → click Retry on the row. This sets:

- `status` → `pending`
- `attempts` → 0
- `last_error` → null
- `next_attempt_at` → CURRENT_TIMESTAMP

The drain loop picks it up within 30s.

## Known skip reasons (`succeeded` rows with `last_error="skipped:..."`)

These aren't errors — the builder deliberately didn't upload because
nothing matchable existed. The succeeded state lets us garbage-collect
the row in the Phase 7 retention job.

| Reason                   | Meaning                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `skipped:past_window`    | Lead's first_seen_at is older than the configured Ads window.                                              |
| `skipped:no_consent`     | No gclid AND `consent_ad_user_data != granted`. Nothing to match on, no consent for hashed-email fallback. |
| `skipped:no_match`       | Granted consent but no email and no gclid.                                                                 |
| `skipped:missing_action` | Event has no `ads_conversion_action` resolved. Should be rare; investigate.                                |

## End-to-end smoke test

After Phase 4 ticket 001 ops work + Phase 5 deploy, run once before
trusting the pipeline for real money:

1. Submit a test lead at the live `/tell-me-about/<segment>` URL with
   a synthetic `?gclid=test_<timestamp>&utm_source=google` query.
   Name it "Test Lead — E2E Phase 5".
2. Check Admin → Leads — row should appear with the right campaign +
   segment + adsCutoffAt populated.
3. Wait ≤ 30s. Check Admin → `?tab=marketing-outbox` — the
   generate_lead row should be `succeeded`. (For recruit-2026,
   `generate_lead` is in Secondary so no Ads-side bidding impact yet.)
4. Click "Attended" on the lead. Wait ≤ 30s. Same outbox tab — the
   `lead_attended_session` row should be `succeeded`.
5. Open Ads UI → Tools → Conversions → look at the per-conversion
   action diagnostics. The conversion should appear within a few
   minutes.
6. Delete the test lead from the DB once verified:
   ```sql
   DELETE FROM lead WHERE email = 'test-e2e@percymain.org';
   -- marketing_event + marketing_outbox cascade.
   ```

## Forced-failure dead-letter test

To exercise the dead-letter path during a release:

1. In a sandbox environment (not prod), edit
   `packages/shared/src/marketing/campaigns.ts` to point a single
   conversion action at a deliberately-wrong resource name.
2. Trigger an event that resolves to that action.
3. Watch the outbox row: pending → first attempt fails →
   AdsValidationError → straight to `dead` (validation errors don't
   retry).
4. Hit Retry from the admin UI. Confirm the row goes back to `pending`,
   then to `dead` again until you fix the resource name.

## Escalation path

- Code-level bugs: file a GitHub issue, tag `marketing-pipeline`.
- Ads policy / account suspension: read the suspension email carefully,
  fix the cited issue, request review via Ads UI. Ad Grants accounts
  do not get an automatic appeal.
- Data subject requests: delete the relevant `lead` row; the cascade
  removes `marketing_event` and `marketing_outbox`. Document the
  request internally per the privacy notice.
