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
      7 days within ±5%. Use the `04-reconciliation-gate.md` SQL.
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

## Recruit-2026 ad-copy review

Ad-copy-specific checks layered on top of the standing weekly review.
Same Monday slot, ~5 extra minutes when copy is healthy, longer if a
creative is being rewritten.

### Per-segment, per-ad-group performance (every Monday)

For each of the four segments and both ad groups within each segment
(`senior_men_cricket` × {near-me, training}, `senior_women_softball_cricket`
× {club, softball}, `junior_boys_cricket` × {junior club, kids
training}, `junior_girls_dynamos_cricket` × {girls club, dynamos}):

- [ ] **Impressions** for the trailing 7 days. Zero impressions in any
      ad group for 7 days → keyword/match-type review, not a copy
      problem yet.
- [ ] **CTR per ad group**, trailing 7 days. Account-level minimum is
      5% (Ad Grants); ad-group-level expectation is also 5%+ for
      tightly-themed groups.
- [ ] **Conversions per ad group**, trailing 7 days. Compare against
      DB `marketing_event WHERE campaign_id='recruit-2026' AND
segment=<segment_key>` over the same window.
- [ ] **CTR by individual asset (headline / description)** in the RSA
      asset report. Ads marks each asset Best / Good / Low. Flag any
      asset stuck at "Low" for > 14 days.

### When to refresh ad copy

- **Hard trigger**: any RSA whose ad-group-level CTR sits **below 1%
  for 14 consecutive days** → pause that ad group's RSA, rewrite, and
  republish from the segment's markdown file in
  `plans/ad-campaign-mk1/ad-copy/`. Do not edit copy directly in the
  Ads UI without committing the change back to the markdown — the
  markdown is the source of truth.
- **Soft trigger**: any individual headline or description marked
  "Low" by Ads' asset rating for 14+ days → swap that asset for a
  fresh variant from the segment file (or write a new one). Keep the
  pinned-position discipline: if a slot is pinned, replace within the
  same slot.
- **Search-term drift**: if the search-terms report shows the ad group
  is matching intents the copy doesn't speak to, rewrite copy to match
  the actual intent or split the ad group.
- **Compliance break**: any keyword paused for QS ≤ 2 → check whether
  the ad copy is the cause (relevance) before assuming the keyword
  itself is at fault.

### Quarterly club-led copy review

Ad copy is a club-voice asset, not a tech artefact. Every quarter
(first Monday of Jan / Apr / Jul / Oct):

- [ ] Walk the club through the four segment markdown files. Confirm
      everything still reads true to the club: training times, format
      (softball vs hardball), Dynamos pathway, charity number,
      coaches' DBS status, "first session free" promise.
- [ ] Replace any copy the club has outgrown. Common reasons: a team
      folds or splits, a new pathway opens (e.g. women's hardball), a
      coach leaves, the ground postcode or address changes.
- [ ] Refresh seasonal angles. Pre-season (Jan–Mar) emphasises indoor
      nets and "register early"; mid-season (Apr–Jul) emphasises
      live matches and trial-this-week; off-season (Aug–Dec) softens
      the ask and leans on indoor / next-season framing.
- [ ] Re-run the character-count check on any line that was edited.
      The hard limits (30 / 90 / 35) do not move.

The quarterly review is recorded in the decision log with a one-line
summary even when nothing changes.

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
