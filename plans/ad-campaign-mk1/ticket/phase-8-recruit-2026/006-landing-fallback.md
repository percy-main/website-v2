# 006 — Fallback page: `/tell-me-about`

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: 001
**Effort**: S

## Context

Catches organic traffic and ad-click mismatches where the segment isn't implied by the URL. Single page with a segment picker; form variant toggles based on selection.

## Scope

### In

- `apps/web/src/pages/tell-me-about/index.tsx`.
- Four segment cards (or a select), one per segment, linking to the dedicated pages.
- Alternative: include the `<LeadForm>` inline with `<SegmentPicker>` so visitors don't need to click again; form variant switches between adult/junior based on selection.
- No attribution conventions need to change — `pm_attrib` is already set from whatever URL they arrived on.

## References

- [RECRUIT_CAMPAIGN.md §4 Landing pages (fallback)](../../RECRUIT_CAMPAIGN.md#4-landing-pages)

## Acceptance

- [ ] `/tell-me-about` renders.
- [ ] Segment picker works; form variant adapts.
- [ ] Submit end-to-end with the picked segment.
