# 004 — Landing page: `/tell-me-about/junior-boys`

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 002
**Effort**: S

## Context

Junior boys cricket landing page. Parent/guardian is the target reader. Includes the safeguarding reassurance block (one line + link) per the doc spec.

## Scope

### In

- `apps/web/src/pages/tell-me-about/junior-boys.tsx`.
- Route registered.
- Structure:
  - Hero (aimed at parents).
  - Four essentials (age band we cater for, training day/time, what to bring, what happens after submit).
  - "Trial is free" line.
  - **Safeguarding reassurance** — one line + link to the club's safeguarding policy.
  - Form headline.
  - `<LeadForm campaignId="recruit-2026" segment="junior_boys_cricket" variant="junior" />`.
- Copy tone: parent-friendly, not kid-friendly (parents are the decision-makers).

## References

- [RECRUIT_CAMPAIGN.md §4 Landing pages + safeguarding block](../../RECRUIT_CAMPAIGN.md#4-landing-pages)

## Acceptance

- [ ] `/tell-me-about/junior-boys` renders.
- [ ] Safeguarding one-liner + link present.
- [ ] Form uses `variant="junior"` and collects parent contact details.
- [ ] Submit end-to-end works with correct segment.
