# Weekly Ads campaign review checklist

Owner: Alex (sole admin during launch). 15-minute Monday review.

This checklist covers both Phase 6 ticket 002 (post-bidding-promotion
review cadence) and Phase 8 ticket 008 (recruit-2026-specific weekly
ops). Once the campaign is in steady state both lists merge into the
same Monday slot.

## Standing checks (every Monday)

### Ad Grants compliance

- [ ] **Account-level CTR ≥ 5%** for the trailing 7 days. Two
      consecutive sub-5% months triggers Ad Grants underperforming-
      account status.
- [ ] **Quality Score distribution** — Ads UI → Keywords → add the QS
      column. Pause anything at QS 1 or 2. QS 3 review manually.
- [ ] **Single-word / generic keywords** — none should be live
      (except "Percy Main" brand terms).

### Search terms hygiene

- [ ] Per-campaign search-terms report → add exact-match negatives
      for irrelevant matches. Common starter negatives already in
      place: jobs, equipment, bats, shop, buy, watch, live score,
      IPL, England, international, free stream.
- [ ] Anything broad-matching outside the catchment → consider
      tightening the geo target.

### Conversion reconciliation (Phase 6+ only)

- [ ] Per-segment `generate_lead` Ads count vs DB count for the last
      7 days within ±5%. Use the `reconciliation-gate.md` SQL.
- [ ] `lead_attended_session` and `lead_became_member` Ads counts vs
      DB counts. Should also match within ±5%.
- [ ] Outbox: `marketing_outbox` `dead` count = 0. Anything > 0 →
      runbook dead-letter triage.
- [ ] CPA per campaign — flag week-on-week +50% jumps.

### Recruit-2026 specifics

- [ ] Per-segment conversion counts. If one segment is starving (zero
      for 7 days), check ad copy and keyword match types.
- [ ] **Slack `#new-leads` volume vs Admin → Leads count** for the
      same 7-day window. Discrepancy = something dropping; investigate
      Slack webhook health.
- [ ] **Lead response time**: mean delta from `generate_lead` event
      to `lead_contacted` event. Internal target is 1 hour. Anything
      consistently > 4h means the response workflow needs attention.
      Computed from the events timeline on the Leads tab; export to
      CSV if needed.

### Budget

- [ ] Compare spend vs notional $329/day cap. Grants accounts rarely
      exhaust delivery; sustained throttling at the cap means we're
      under-spending on opportunity.

## Cadence beyond launch

After 8 consecutive weeks of clean reviews, the cadence can drop to
every other Monday (still 15 min) but the same checklist applies.
Monthly ad-grants underperforming-account audits remain weekly until
the account has 3 months of clean compliance history.

## Decision log

Append findings + actions taken at the bottom of this file each week.
The first review (date filled in when run) gets a baseline entry even
if "nothing unusual".

```
### 2026-MM-DD
- Findings: ...
- Actions: ...
- Next review: 2026-MM-DD
```
