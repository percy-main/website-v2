# 007 — Ad copy drafting (RSA headlines + descriptions + sitelinks)

**Phase**: 8 — Recruit-2026 campaign
**Depends on**: phase-4-ads-online/001 (campaigns exist), landing pages ready
**Effort**: M (mostly writing time)

## Context

Responsive Search Ads need a bank of headlines and descriptions per ad group. Written collaboratively — club voice from Alex, structure/variants from Claude, character-limit compliance.

## Scope

### In

- **Per segment**, 10–15 headlines (≤30 chars each) and 3–4 descriptions (≤90 chars each). One primary RSA per ad group. Starting ad-group structure from [`RECRUIT_CAMPAIGN.md` §9](../../RECRUIT_CAMPAIGN.md#9-ad-grants-compliance-checklist):
  - Men's: "cricket club near me", "adult cricket training".
  - Women's: "women's cricket club", "women's softball cricket".
  - Junior Boys: "junior cricket club", "kids cricket training".
  - Junior Girls: "girls cricket club", "dynamos cricket".
- **Sitelinks** (account-level, 4–6 unique): About the club, Fixtures, Safeguarding, Contact — each with a short description (≤35 chars each description line).
- **Path fields** for each ad: 15 chars max each, e.g. `/cricket-club` + `/north-tyneside`.
- Record the final copy as a markdown asset under `plans/ad-campaign-mk1/ad-copy/<segment>.md` so it's version-controlled alongside the plan.

### Out

- Keyword list (ops task, driven by the ad-group structure + search terms review).
- Ad extensions beyond sitelinks (callouts, structured snippets — maybe Phase 7 polish).

## Approach

- Draft in a doc per segment, iterate with the club, paste into Ads once approved.
- Common failure mode: generic / branded-sounding headlines ("Percy Main CC") that don't reflect search intent. Prefer intent-anchored headlines ("Men's cricket in North Tyneside", "Your first session is free").

## References

- [RECRUIT_CAMPAIGN.md §9 Ad Grants compliance (starter ad-group structure)](../../RECRUIT_CAMPAIGN.md#9-ad-grants-compliance-checklist)
- [RECRUIT_CAMPAIGN.md §12 Content ownership](../../RECRUIT_CAMPAIGN.md#12-content-ownership)

## Acceptance

- [ ] Copy assets committed under `plans/ad-campaign-mk1/ad-copy/<segment>.md`.
- [ ] RSAs created in Ads per segment, with all character limits respected.
- [ ] Sitelinks live at account level.
- [ ] First impression of each RSA shown in Ads (confirms approval + delivery).
