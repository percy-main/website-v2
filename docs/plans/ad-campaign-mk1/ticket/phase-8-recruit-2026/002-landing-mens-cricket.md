# 002 — Landing page: `/tell-me-about/mens-cricket`

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 001
**Effort**: S

## Context

Dedicated landing page for the men's cricket Ads campaign. Content written collaboratively with the club.

## Scope

### In

- `apps/web/src/pages/tell-me-about/mens-cricket.tsx` — lazy route.
- Route registered in `apps/web/src/router.tsx`.
- Structure per [`RECRUIT_CAMPAIGN.md` §4](../../RECRUIT_CAMPAIGN.md#4-landing-pages):
  - Hero: 2–3 lines + image.
  - Four essential reassurance items: who it's for, training day/time, what to bring, what happens after submit.
  - "Trial is free" line.
  - (No safeguarding block — adults.)
  - Form headline (one line).
  - `<LeadForm campaignId="recruit-2026" segment="senior_men_cricket" variant="adult" />`.
  - Footer links already live in the site layout; ensure this page uses the default layout so they appear.
- SEO: descriptive `<title>`, meta description, canonical URL, OpenGraph image.

### Out

- Image asset sourcing (coordinated separately; placeholder OK for first deploy).

## Approach

- Shared `<RecruitHero>`, `<ReassuranceList>`, `<TrialIsFree>` components if there's enough repetition across the four pages — build these while doing the first landing page and reuse.

## References

- [RECRUIT_CAMPAIGN.md §4 Landing pages](../../RECRUIT_CAMPAIGN.md#4-landing-pages)

## Acceptance

- [ ] `/tell-me-about/mens-cricket` returns a 200 with the hero + form.
- [ ] Lighthouse: LCP < 2.5s, CLS ≈ 0.
- [ ] Form submit end-to-end works against the API.
