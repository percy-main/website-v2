# Campaign registry population (Phase 4 ticket 003)

The registry at `packages/shared/src/marketing/campaigns.ts` currently
ships with `customers/0/conversionActions/...` placeholder resource names
and `PLACEHOLDER_*` conversion labels. These are intentionally bogus so
nothing actually fires to Google Ads until both:

1. The Phase 4 ticket 001 ops work is done (real conversion actions exist
   in the Ads UI), and
2. Real resource names + conversion labels are pasted into the registry
   via this ticket's PR.

## Steps

When ticket 4-001 is complete, open the Ads UI → Tools → Conversions and
copy each action's:

- **Resource name**: full `customers/<customer_id>/conversionActions/<id>`
  string. Visible on the action's detail page.
- **Conversion label**: short alphanumeric tag found on the "Tag setup"
  page; this is what `send_to` uses.

Replace the entries in `packages/shared/src/marketing/campaigns.ts`:

```ts
generate_lead: {
  senior_men_cricket: { resourceName: "...", conversionLabel: "..." },
  senior_women_softball_cricket: { resourceName: "...", conversionLabel: "..." },
  junior_boys_cricket: { resourceName: "...", conversionLabel: "..." },
  junior_girls_dynamos_cricket: { resourceName: "...", conversionLabel: "..." },
},
lead_attended_session: {
  _all: { resourceName: "...", conversionLabel: "..." },
},
lead_became_member: {
  _all: { resourceName: "...", conversionLabel: "..." },
},
```

Run `pnpm -w run typecheck` afterwards — the type-level
`AssertAllSegmentsHavePrimaryAction<"recruit-2026">` guard will fail to
compile if any segment is dropped or mistyped.

## Verification

- [ ] `pnpm -w run typecheck` passes.
- [ ] Each `resourceName` matches what Ads UI → Tools → Conversions shows.
- [ ] Each `conversionLabel` matches the Tag setup page.
- [ ] No `PLACEHOLDER_*` strings remain.
