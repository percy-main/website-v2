# 005 — Landing page: `/tell-me-about/junior-girls`

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 004
**Effort**: S

## Context

Junior girls Dynamos cricket landing page. Parent-targeted, includes safeguarding block. Copy mentions Dynamos because that's what the club runs for girls in this age bracket.

## Scope

### In

- `apps/web/src/pages/tell-me-about/junior-girls.tsx`.
- Route registered.
- Structure identical to ticket 004.
- Copy explains what ECB Dynamos is at a parent-reader level ("the national FA-backed programme for 8–11 year olds, focused on learning the game in a fun, mixed-ability setting").
- `<LeadForm campaignId="recruit-2026" segment="junior_girls_dynamos_cricket" variant="junior" />`.

## References

- [RECRUIT_CAMPAIGN.md §4 Landing pages](../../RECRUIT_CAMPAIGN.md#4-landing-pages)
- [RECRUIT_CAMPAIGN.md §2 Segments (Dynamos context)](../../RECRUIT_CAMPAIGN.md#2-segments)

## Acceptance

- [ ] `/tell-me-about/junior-girls` renders.
- [ ] Dynamos format explained in parent-accessible language.
- [ ] Form uses `variant="junior"` with correct segment.
