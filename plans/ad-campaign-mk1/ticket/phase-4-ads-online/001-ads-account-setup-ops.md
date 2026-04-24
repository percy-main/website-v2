# 001 — Google Ads account setup (ops)

**Phase**: 4 — Ads online conversions, soft launch
**Depends on**: none (parallel with platform phases)
**Effort**: M (clock time dominated by Google's approval queues)

## Context

Pure ops work, mostly in the Google Ads UI. Unblocks the code-side work in this phase. Plan to start early because some steps have multi-day Google approval waits.

## Scope

### In

1. **Add a second admin** to the Ads account at customer ID `882-123-5703` (bus-factor fix noted in `CONVERSION_TRACKING.md` §21). Pick another trustee.
2. **Enable auto-tagging** on the Ads account so `{gclid}` is appended to all ad URLs automatically.
3. **Apply for Google Ads API access** on the account → generate a **developer token** (Basic tier sufficient). Google approval takes 2–5 working days.
4. **Create the GCP project** `percy-main-marketing` under the club's Google Workspace.
5. **Create an OAuth2 client** in that GCP project; generate a **refresh token** via the OAuth playground tied to `alex.young@percymain.org`. Store the client ID, client secret, refresh token, developer token, and Ads customer ID in **AWS Secrets Manager** under a single secret per the existing Stripe / SES pattern. Add Terraform + IAM so the Fastify task role can read it.
6. **Create six conversion actions** (setup details in `RECRUIT_CAMPAIGN.md` §8 step 2):
   - `generate_lead` × 4 (one per segment), 30-day click-through + 1-day view-through, value £0, count "one per click", **Secondary** column.
   - `Attended Session`, 60-day click-through, count "every", value £50 flat placeholder, Secondary column.
   - `Became Member`, 60-day click-through, count "every", value £50 flat, Secondary column.
7. **Create four campaigns** (one per segment), **Maximize Clicks** bidding (Ad Grants-safe bootstrap), Search only, geo-targeted to the club's catchment (NE27 / NE28 / NE29 / NE30 + radius — confirm at setup).
8. **Set up ≥4 account-level sitelinks**: About, Fixtures, Safeguarding, Contact — match routes from `RECRUIT_CAMPAIGN.md` §4 footer.

### Out

- Ad copy / ad groups / keywords (Phase 8).
- Any bidding change from Maximize Clicks (Phase 6).

## References

- [CONVERSION_TRACKING.md §21 Operational notes for Phase 1](../../CONVERSION_TRACKING.md#21-operational-notes-for-phase-1)
- [RECRUIT_CAMPAIGN.md §8 Ads account setup checklist](../../RECRUIT_CAMPAIGN.md#8-ads-account-setup-checklist)
- [RECRUIT_CAMPAIGN.md §9 Ad Grants compliance checklist](../../RECRUIT_CAMPAIGN.md#9-ad-grants-compliance-checklist)

## Acceptance

- [ ] Second admin added.
- [ ] Auto-tagging enabled.
- [ ] Developer token approved and stored in AWS Secrets Manager.
- [ ] Six conversion actions created in Secondary column.
- [ ] Four campaigns created on Maximize Clicks, local geo-targeted.
- [ ] Conversion-action resource names captured for ticket 003.
