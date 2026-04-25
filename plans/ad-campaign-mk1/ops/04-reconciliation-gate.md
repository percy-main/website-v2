# 14-day reconciliation validation gate (Phase 4 ticket 004)

After Phase 4 tickets 002 + 003 ship and Ads conversions are firing in
the Secondary column, run this gate over 14 days of live traffic before
Phase 6 promotes generate_lead to Primary and switches bidding.

## Reconciliation script

Per-segment per-day counts from our DB:

```sql
SELECT
  date_trunc('day', created_at::timestamp) AS day,
  segment,
  count(*) AS db_count
FROM marketing_event
WHERE type = 'generate_lead'
  AND campaign_id = 'recruit-2026'
  AND created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

In Google Ads UI, open the four `recruit-2026 / Generate Lead / *`
conversion actions, switch the date range to "Last 14 days", export the
per-day breakdown.

## Tolerance

- Ads count vs DB count within **±5%** per segment per 14-day window.
- Anything outside that gets investigated before promoting.

Common explanations for a small gap:

- gtag.js blocked by an ad-blocker (DB count > Ads count).
- Cross-device clicks (Ads gets credit, our DB gets the conversion under
  a different session).
- Consent-declined sessions: DB still records, Ads reports modelled
  conversions only.

A gap > 10% needs a real investigation — most likely a wiring bug in
Phase 4 ticket 002 (e.g. `send_to` label mismatch).

## Spot-check 5 random leads

Pick 5 leads from the last 14 days where consent was granted and
attribution.gclid is set:

```sql
SELECT id, email, attribution
FROM lead
WHERE first_campaign_id = 'recruit-2026'
  AND consent_ad_user_data = 'granted'
  AND attribution->>'gclid' IS NOT NULL
  AND created_at >= now() - interval '14 days'
ORDER BY random()
LIMIT 5;
```

For each, verify in the Ads UI:

- The conversion appears credited to the right per-segment conversion
  action (not falling through to `_all`).
- The "User-provided data" diagnostic shows that hashed email was
  received.
- Attribution → click corresponds to the gclid stored in the `lead`
  row.

## Decision

- [ ] 14 days elapsed since Phase 4 launch.
- [ ] DB vs Ads reconciliation within ±5% per segment.
- [ ] 5/5 spot-checked leads look correct in Ads diagnostics.
- [ ] No `marketing_outbox` `dead` rows for offline events (still
      pre-Phase-5, so this should be empty by definition).
- [ ] **Decision recorded**: proceed to Phase 5 (offline forwarder).
