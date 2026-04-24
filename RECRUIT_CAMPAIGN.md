# Recruit 2026 — Campaign Design

The first campaign to run on the conversion tracking platform defined in [`CONVERSION_TRACKING.md`](./CONVERSION_TRACKING.md). This document covers only what is specific to the Google Ad Grants recruitment push. Anything architectural — tables, endpoints, attribution, consent, forwarding — lives in the platform doc.

---

## 1. Campaign goal

Recruit new players across four audience segments via Google Ad Grants, driving them to submit a high-intent lead ("Try a free training session"), which the club can then convert into attendance and eventually paid membership.

Campaign ID (in the platform registry): `recruit-2026`.

---

## 2. Segments

Four campaign segments, each its own Ads campaign and its own conversion action:

| Segment key                     | Public label (provisional)     | Audience                         |
| ------------------------------- | ------------------------------ | -------------------------------- |
| `senior_men_cricket`            | Men's Cricket                  | Men 18+, hardball cricket        |
| `senior_women_softball_cricket` | Women's Softball Cricket       | Women 18+, ECB softball format   |
| `junior_boys_cricket`           | Junior Boys Cricket            | Boys school years 1–11           |
| `junior_girls_dynamos_cricket`  | Junior Girls — Dynamos Cricket | Girls on the ECB Dynamos pathway |

### Naming convention

Segment keys are structured `{audience}_{gender}_{format?}_{sport}` so we can add future campaigns without renaming:

- Future women's hardball cricket: `senior_women_hardball_cricket`
- Future girls' All-Stars: `junior_girls_allstars_cricket`
- Future other sports: `senior_men_football`, etc.

Public labels are the working copy; final wording is an open question (§10).

An additional `unknown` segment exists at the platform level but is not a recruitment target — it catches leads who reached a generic contact form without a segment parameter.

---

## 3. Conversion model for this campaign

Mapping of platform events to Google Ads conversion actions for `recruit-2026`:

| Platform event          | Ads role          | Per-segment action?  | Value        |
| ----------------------- | ----------------- | -------------------- | ------------ |
| `generate_lead`         | **Primary**       | Yes, one per segment | £0           |
| `lead_attended_session` | Offline secondary | No, one shared       | £0           |
| `lead_became_member`    | Offline secondary | No, one shared       | **£50 flat** |
| `purchase`              | Observation only  | No                   | N/A          |

Rationale:

- `generate_lead` is the bidding target because it is the earliest point with enough signal. Per-segment conversion actions let bidding be tuned differently for men's vs women's vs junior cohorts without splitting the pipeline.
- `lead_attended_session` and `lead_became_member` are reported as offline conversions so Ads learns which _kinds_ of leads actually convert — but they start in Observation columns, not Primary, to avoid biasing bidding while volumes are tiny.
- `lead_became_member` carries a flat **£50** value rather than true annual fees. Although adult membership fees are higher than junior fees, adult players carry proportionally higher costs (field time, equipment, insurance). Net contribution per member is roughly comparable, and signalling equal value prevents Smart Bidding from skewing toward adults when it eventually runs. We'll revisit at Phase 6 when real CPA data is available.
- Membership purchase is tracked for reporting but not used for bidding directly; the chain `ad click → trial form → attended → joined` is what matters.

---

## 4. Landing pages

Four dedicated segment pages plus a fallback. URL shape is user-voice (`/tell-me-about/...` — what the visitor wants to know), which extends naturally to non-recruitment pages later: `/tell-me-about/volunteering`, `/tell-me-about/sponsorship`, etc.

- `/tell-me-about/mens-cricket`
- `/tell-me-about/womens-cricket`
- `/tell-me-about/junior-boys`
- `/tell-me-about/junior-girls`
- `/tell-me-about` (optional index/fallback; for recruitment it picks a segment, for other topics it could list them)

Each is a React Router lazy route under `apps/web/src/pages/tell-me-about/`. Each renders:

- A short segment-specific hero (copy + image).
- The shared `<LeadForm campaignId="recruit-2026" segment="…" />` component from the platform.
- 2–3 pieces of segment-relevant reassurance (training times, coach, what to bring).
- Link to the privacy page.

URL slugs are format-neutral (matching the public labels); enum keys retain the format detail. Nobody sees enum keys; everybody sees URLs.

### Content

Written collaboratively. Each page needs:

- Hero: 2–3 lines + a single relevant image.
- Reassurance: 3 short items (when training happens, who'll meet you, what to bring).
- Form headline: one line that restates the ask in segment terms.

Shared structure keeps the effort small — hero block + reassurance block + form component, parameterised per segment.

---

## 5. Trial form fields

Short by design — every extra field costs conversion rate.

### Adult segments (men's, women's)

- **Name** (required)
- **Email** (required)
- **Phone** (optional — helper: "Add a number if you'd like us to call — we'll email otherwise")
- **Notes** (optional — placeholder: "Anything we should know? Previous experience, preferred day, questions…")

### Junior segments (boys, girls)

Parent/guardian is the primary contact. Submitting the form is implied consent to contact the parent.

- **Child's name** (required)
- **Parent/guardian name** (required)
- **Parent/guardian email** (required)
- **Parent/guardian phone** (optional)
- **Notes** (optional)

Age / school year is captured during follow-up contact, not on the form. Medical info and formal consents live on the existing `/api/junior/dependents` flow if/when the family chooses to register.

### Shared behaviour

- Segment is prefilled from the URL (`?segment=<segment_key>`) — only shown as an editable select on the `/tell-me-about` fallback page.
- Honeypot field + client-side rate limit. No CAPTCHA on v1 — add only if spam actually appears.
- No marketing opt-in checkbox — trial contact is in-scope for the form's purpose. A separate newsletter signup can be added elsewhere if the club wants one.

### Post-submit state

No confirmation email. The form submit success state is the communication.

Inline, on the same page, the form is replaced with a personalised message keyed on the name the user entered. For adults:

> Thanks {name} — someone from Percy Main will be in touch within **1 working day**.
>
> If you haven't heard from us by then, please email `trustees@percymain.org` and we'll sort it out.

For juniors, personalised on the child's name:

> Thanks — we'll be in touch about {child_name}'s trial within **1 working day**.
>
> If you haven't heard from us by then, please email `trustees@percymain.org`.

Implementation: the success state uses the name already in client-side form state; no extra API call, no email template to maintain.

---

## 6. Lead response workflow

- **Slack**: all lead notifications go to a single channel (e.g. `#new-leads`). Notification includes name, segment, campaign, notes, and a link to the admin lead row.
- **Response SLA**: **1 working day** stated to the user on the post-submit screen. **1 hour** internal target for first reply.
- **Handled by**: admin only (Alex). Admin UI is the system of record for "did we reply?" via the `Contacted` outcome button, which emits the `lead_contacted` event.
- **No confirmation email**: covered by the post-submit state above.
- **Escalation**: if the internal 1-hour target is missed, no automated chase — but missed SLAs will show up in admin reporting (time between `generate_lead` event and `lead_contacted` event) and can be reviewed weekly.

---

## 7. UTM tagging convention

Applied to every ad URL so that ads-side and our-side reporting reconcile:

```
utm_source=google
utm_medium=cpc
utm_campaign=recruit-2026
utm_content=<ad-group-or-creative-id>
utm_term={keyword}        (Google auto-expands)
```

Plus `{gclid}` appended by Google automatically when auto-tagging is enabled in the Ads account (which it should be).

Landing page URLs also carry `?segment=<segment_key>` so the form can prefill. The platform's `attribution.ts` captures all of the above on first touch.

---

## 8. Ads account setup checklist

One-time setup, outside the codebase, before Phase 3 of the platform rollout:

1. Enable auto-tagging on the Google Ads account.
2. Create six conversion actions:
   - `recruit-2026 / Generate Lead / Men's Cricket`
   - `recruit-2026 / Generate Lead / Women's Softball Cricket`
   - `recruit-2026 / Generate Lead / Junior Boys Cricket`
   - `recruit-2026 / Generate Lead / Junior Girls Dynamos`
   - `recruit-2026 / Attended Session` (one, all segments)
   - `recruit-2026 / Became Member` (one, all segments)
3. Set each `generate_lead` action to count "one per click", value £0, 30-day click-through, 1-day view-through. Add to Secondary conversions column initially.
4. Set the two offline actions to count "every", same windows, Secondary column.
5. Record the resource names of each in the campaign registry (`packages/shared/src/marketing/campaigns.ts`) via a PR.
6. Create four campaigns in Ads, one per segment, each targeting its own conversion action.
7. Start on **Manual CPC bidding**. Do not switch to Smart Bidding / Maximise Conversions until §8 validation completes.

---

## 9. Validation before bidding on these conversions

This campaign is the first real traffic through the pipeline; bad conversion data here will poison future Smart Bidding. Before promoting `generate_lead` to the Primary conversion column:

- 14 days of live traffic with conversions flowing.
- Ads `generate_lead` count matches `marketing_event WHERE type='generate_lead' AND campaign_id='recruit-2026'` within ±5%.
- Spot-check 5 random leads: `lead.attribution.gclid` is set, hashed email was included, Ads shows the conversion credited to the right campaign and segment.
- No admin-facing error spikes in `marketing_outbox` for offline events (check at ~30 days when first "attended" outcomes start being marked).

Only then promote to Primary and optionally enable Maximise Conversions bidding.

---

## 10. Rollout (specific to this campaign, sits on top of platform phases)

This assumes the platform is rolling out in parallel per [`CONVERSION_TRACKING.md` §19](./CONVERSION_TRACKING.md). Campaign milestones:

1. **After platform Phase 1** (schema, consent, banner live): write segment landing pages + form copy. No ads running yet.
2. **After platform Phase 2** (lead capture endpoint + admin leads tab): smoke-test by submitting forms manually with `?gclid=test&utm_source=google&...` URLs. Confirm admin tab shows them correctly.
3. **After platform Phase 3** (GA4 via gtag): turn on a small budget (£5–10/day across all four campaigns) pointing at the live landing pages. This is to generate realistic traffic, **not** to acquire — we do not yet trust the conversion pipeline.
4. **After platform Phase 4** (Ads online conversions in Secondary): ramp budget. Start 14-day validation window.
5. **After platform Phase 5** (offline forwarder): admins start marking "Attended" outcomes as sessions happen. Upload starts flowing. Monitor outbox.
6. **After platform Phase 6** (promoted to Primary + Smart Bidding): campaign enters steady-state optimisation. Weekly CPA review.

### Lifecycle

Campaign runs year-round. Seasonal intent (cricket-season peak Apr–Jul, preseason Jan–Mar, quiet Aug–Dec) is managed via Ads budget flexing, not via separate campaign IDs. When `recruit-2027` is ready to go live (typically during January preseason planning), the switchover is simple: pause `recruit-2026` Ads campaigns in Google Ads, add `recruit-2027` to the registry and its new conversion actions in Ads. The `recruit-2026` registry entry stays indefinitely for historical reporting — no tombstone, no migration. Existing leads keep their campaign tag forever.

---

## 11. Content ownership

Landing page copy and ad copy are both written collaboratively. Club voice from Alex; structure, variants, and compliance with Google's character limits from Claude.

For Responsive Search Ads each segment needs ~10–15 headlines (30 chars max) and ~3–4 descriptions (90 chars max) plus sitelinks. The volume is deceptive — most are small variations. A collaborative session per segment should produce a full pass.
