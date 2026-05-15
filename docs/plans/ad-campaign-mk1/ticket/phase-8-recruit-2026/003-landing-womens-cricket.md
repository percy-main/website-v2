# 003 — Landing page: `/tell-me-about/womens-cricket`

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 002
**Effort**: S

## Context

Same structure as the men's page, copy tuned for women's softball cricket (public label is format-neutral; page copy can describe the softball format).

## Scope

### In

- `apps/web/src/pages/tell-me-about/womens-cricket.tsx`.
- Route registered.
- Same 7-element structure as ticket 002.
- `<LeadForm campaignId="recruit-2026" segment="senior_women_softball_cricket" variant="adult" />`.
- Copy explains "Women's Softball Cricket" at a level of detail an ECB-naive reader would understand (e.g. "a shorter, more welcoming format of the game — perfect if you've never picked up a bat before").

## References

- [RECRUIT_CAMPAIGN.md §4 Landing pages](../../RECRUIT_CAMPAIGN.md#4-landing-pages)
- [RECRUIT_CAMPAIGN.md §2 Segments (women's softball context)](../../RECRUIT_CAMPAIGN.md#2-segments)

## Acceptance

- [ ] `/tell-me-about/womens-cricket` renders.
- [ ] Copy explains the softball format without jargon.
- [ ] Form submit works end-to-end with the correct segment.
