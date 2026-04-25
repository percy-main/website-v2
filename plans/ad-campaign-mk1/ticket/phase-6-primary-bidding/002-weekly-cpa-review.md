# 002 — Weekly CPA review cadence

**Phase**: 6 — Promote to primary bidding
**Depends on**: 001
**Effort**: S

## Context

Once Smart Bidding is on, weekly eyes-on-numbers prevents a runaway CPA or Ad Grants compliance drift. Ops-only; just setting up the review.

## Scope

### In

- Recurring calendar event: every Monday, 15 min review.
- Minimum review checklist:
  - Account-level CTR ≥ 5% (Ad Grants requirement).
  - Per-campaign conversion count + CPA.
  - Any `generate_lead` / `lead_attended_session` / `lead_became_member` counts that seem out of line vs DB.
  - Search terms report — add negatives.
  - Any keywords at QS ≤ 2 — pause.
  - Outbox `dead` count — investigate if non-zero.
- Document the checklist as `plans/ad-campaign-mk1/weekly-review.md`.

### Out

- Any automation (deferred; could be a TODO once the manual cadence has flushed out what matters).

## References

- [RECRUIT_CAMPAIGN.md §9 Weekly operations](../../RECRUIT_CAMPAIGN.md#9-ad-grants-compliance-checklist)

## Acceptance

- [ ] Weekly calendar event exists.
- [ ] `weekly-review.md` committed.
- [ ] First review completed and outcome noted.
