# Phase 6 ticket 001 — Promote generate_lead to Primary + switch bidding

Pure ops, no code. Run after Phase 5 ticket 005's smoke test passes
end-to-end and Phase 4 ticket 004's reconciliation gate is clean.

## Steps in the Ads UI

1. Tools → Conversions → for each of the four
   `recruit-2026 / Generate Lead / *` actions:
   - Move from **Secondary** to **Primary** column.
2. For each of the four `recruit-2026` campaigns:
   - Settings → Bidding → switch from **Maximize Clicks** to
     **Maximize Conversions**.
3. Leave `lead_attended_session` and `lead_became_member` in
   **Secondary**. Revisit including them as Primary once we have ≥30
   conversions per month per action (Google's "enough signal"
   threshold).
4. Do **not** enable Maximize Conversion Value yet. The £50 flat
   value on `lead_became_member` is a placeholder; chasing value
   before validating it would skew bidding. Revisit once 3 months of
   real outcome data exists.
5. **Record the date/time** of the Primary promotion + bidding
   switch — this is the demarcation point for any "before / after"
   Smart Bidding comparison.

## Acceptance

- [ ] All four `generate_lead` actions appear under Primary
      conversions in the Ads UI.
- [ ] All four campaigns are on Maximize Conversions.
- [ ] Date / time recorded:

```
Primary + Maximize Conversions enabled at: ____________________
```
