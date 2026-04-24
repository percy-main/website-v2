# 001 — Promote `generate_lead` to Primary + switch bidding

**Phase**: 6 — Promote to primary bidding
**Depends on**: phase-5-offline-forwarder/005 validation passed
**Effort**: XS (ops-only)

## Context

After Phase 5 proves the pipeline end-to-end, we let Ads actually bid on our conversions. Two changes in the Ads UI, no code.

## Scope

### In

1. Move `generate_lead` (all four per-segment actions) from Secondary to **Primary** conversions.
2. Switch each of the four campaigns from **Maximize Clicks** to **Maximize Conversions**.
3. Leave `lead_attended_session` and `lead_became_member` in Secondary for now — they're observation-only. Revisit including them as Primary once we have ≥30 conversions/month per action, per Google's "enough signal" threshold.
4. Do **not** enable Maximize Conversion Value yet — our £50 flat value is a placeholder and we don't want bidding to chase value until we've validated values.
5. Record the date/time of the change — this is the point at which "before / after" Smart Bidding comparisons start.

### Out

- Any code change.
- Bid caps / portfolio bidding strategies.

## References

- [CONVERSION_TRACKING.md §19 Phase 6](../../CONVERSION_TRACKING.md#19-rollout-plan)
- [RECRUIT_CAMPAIGN.md §8 step 7 bidding note](../../RECRUIT_CAMPAIGN.md#8-ads-account-setup-checklist)

## Acceptance

- [ ] All four `generate_lead` actions show as Primary.
- [ ] All four campaigns are on Maximize Conversions.
- [ ] Change date recorded (in the commit message or a shared doc).
