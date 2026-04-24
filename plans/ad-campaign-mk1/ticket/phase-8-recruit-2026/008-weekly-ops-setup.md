# 008 — Weekly ops checklist setup for recruit-2026

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 007 (campaigns live)
**Effort**: XS

## Context

Campaign goes live. Standing weekly ops required by Ad Grants compliance — kept light enough that 15 min on a Monday covers it.

## Scope

### In

- Update `plans/ad-campaign-mk1/weekly-review.md` (started in phase-6-primary-bidding/002) to include recruit-2026-specific checks:
  - Per-segment conversion counts + CPA.
  - Search terms report per campaign → add negatives.
  - QS distribution per campaign → pause ≤ 2.
  - Any dropped impressions due to low quality score.
  - Slack `#new-leads` volume vs DB count sanity check.
  - Lead response time: mean time from `generate_lead` event → `lead_contacted` event (should stay inside the 1-hour internal target).
- Put the first review's findings on record (even if "nothing unusual").

### Out

- Any automation — manual for now.

## References

- [RECRUIT_CAMPAIGN.md §6 Lead response workflow](../../RECRUIT_CAMPAIGN.md#6-lead-response-workflow)
- [RECRUIT_CAMPAIGN.md §9 Weekly operations](../../RECRUIT_CAMPAIGN.md#9-ad-grants-compliance-checklist)

## Acceptance

- [ ] `weekly-review.md` updated with recruit-2026 sections.
- [ ] First weekly review recorded.
