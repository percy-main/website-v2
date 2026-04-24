# Google Ad Grants / Recruitment Campaign Review

Reviewed: 2026-04-24

Scope:

- [`CONVERSION_TRACKING.md`](./CONVERSION_TRACKING.md)
- [`RECRUIT_CAMPAIGN.md`](./RECRUIT_CAMPAIGN.md)

Context: Percy Main is a community sports club with a cricket-focused recruitment campaign and an active Google Ad Grants account with a USD $10,000/month grant budget. The review focuses on Google Ad Grants compliance, UK privacy/electronic marketing law, conversion-tracking integrity, and practical campaign readiness.

This is an engineering and compliance review, not legal advice.

---

## Executive summary

The plan is directionally strong: first-party lead ownership, meaningful conversions, offline outcome tracking, consent-aware Google tagging, and campaign-specific landing pages are the right foundations.

The main risks are not architectural. They are policy and operational details:

1. The plan currently says to start on Manual CPC, which is likely wrong for a modern Ad Grants account.
2. The campaign checklist does not yet include several mandatory Ad Grants account-management controls.
3. The Consent Mode design needs an explicit, defensible PECR/UK GDPR position before launch.
4. Enhanced/offline conversion uploads need stricter consent handling for user-provided data.
5. Landing pages need enough mission-specific content to avoid thin destination risk.

Safeguarding is not a material blocker given the current form design and operating model: the junior form collects parent/guardian contact details, no child contact details, no medical/safeguarding data, and the sole admin is a Level 3 qualified Club Safeguarding Officer. Keep data-minimisation guardrails, but this does not need to block the ads launch.

---

## Findings and recommendations

### 1. Replace Manual CPC with an Ad Grants-safe bidding plan

Risk: High

Current plan:

- `CONVERSION_TRACKING.md` Phase 4 says campaigns run on Manual CPC before Smart Bidding.
- `RECRUIT_CAMPAIGN.md` says start on Manual CPC and do not switch to Maximise Conversions until validation completes.

Why this matters:

Google's current Ad Grants account-management policy says accounts created on or after 2019-04-22 must use conversion-based Smart Bidding for all campaigns, unless using Smart campaigns. Google's budget/bidding guidance says Maximise Clicks can be used to gather initial traffic when there is no conversion data, but the priority should be implementing conversion tracking and switching to Maximise Conversions or Maximise Conversion Value once enough data exists.

Recommendation:

- Remove Manual CPC from both plans unless the account creation date and current grant policy explicitly allow it.
- Use this sequence instead:
  1. Launch with conversion tracking live and conversion actions in Secondary.
  2. If the account has no conversion history, use Maximise Clicks only as a short, documented bootstrapping phase.
  3. Switch to Maximise Conversions once the pipeline is validated and there is enough signal.
  4. Promote `generate_lead` to Primary only after DB vs Ads counts reconcile.

Open check:

- Confirm the Ad Grants account creation date and whether Google has already auto-migrated or constrained bidding strategies in the UI.

> **Action taken**: Accepted. `CONVERSION_TRACKING.md` §19 Phase 4 rewritten to state that Manual CPC is not permitted for post-2019 Ad Grants accounts; launch uses Maximize Clicks as a documented bootstrap; Phase 6 promotes to Maximize Conversions after the validation gate. `RECRUIT_CAMPAIGN.md` §8 step 7 and §10 updated to match. Account-creation-date check remains an operational item for Phase 1.

### 2. Add a formal Ad Grants compliance checklist

Risk: High

The campaign checklist currently covers conversion actions and campaign creation, but it omits several standing Ad Grants requirements.

Recommendation:

Add a new "Ad Grants compliance checklist" section to `RECRUIT_CAMPAIGN.md` covering:

- Geo-targeting: target only the local catchment where a new member could realistically attend training and matches.
- Sitelinks: maintain at least two unique sitelink assets account-wide; preferably add 4-6 useful sitelinks with descriptions.
- CTR: monitor account-level CTR monthly and keep it above 5%; pause low-CTR keywords before they drag the account down.
- Keywords: no single-word keywords except permitted exceptions; no overly generic keywords.
- Quality Score: create an automated rule to pause enabled keywords with Quality Score 1 or 2.
- Structure: at least two tightly themed ad groups per campaign, each aligned to its landing page and ad copy.
- Search terms hygiene: review search terms weekly during launch and add exact-match negatives for irrelevant traffic.
- Budget: treat USD $329/day as the account cap, not a guaranteed spend target.

Practical starting structure:

- Men's campaign: ad groups for "cricket club near me" and "adult cricket training".
- Women's campaign: ad groups for "women's cricket club" and "women's softball cricket".
- Junior boys campaign: ad groups for "junior cricket club" and "kids cricket training".
- Junior girls campaign: ad groups for "girls cricket club" and "dynamos cricket".

Avoid broad generic terms like `cricket`, `sport`, `kids activities`, `things to do`, or unrelated ECB/program names unless the landing page clearly satisfies that exact intent.

> **Action taken**: Accepted. New §9 "Ad Grants compliance checklist" added to `RECRUIT_CAMPAIGN.md` covering account structure (≥2 ad groups per campaign, ≥2 sitelinks), keyword rules (no single-word, no generic, QS ≤ 2 pause), 5% account-level CTR minimum, local geo-targeting, weekly search-terms hygiene, budget-cap semantics, and the suggested starting ad-group structure per segment. Weekly launch-period ops checklist (search terms, QS, CTR, reconciliation) included.

### 3. Make the Consent Mode position explicit before launch

Risk: High

The platform plan chooses Full / Advanced Consent Mode: load `gtag.js` on every page, default storage denied, then continue cookieless pings after decline.

Why this matters:

ICO PECR guidance treats storage/access technologies broadly, including scripts/tags, link decoration, tracking pixels, and similar technologies. Online advertising measurement requires consent as part of the advertising purpose. Google's EU User Consent Policy also requires legally valid consent, clear revocation instructions, and records of consent for EEA/UK/Swiss users where applicable.

Recommendation:

Pick one of these positions before implementation:

- Conservative launch: use Basic Consent Mode. Do not load Google tags until the user accepts. This maximises privacy defensibility and is simplest to explain.
- Measurement-optimised launch: keep Advanced Consent Mode, but document the legal rationale and make the UX/privacy notice precise about cookieless pings and Google measurement.

Minimum changes either way:

- Add a persistent "Cookie settings" link in the footer or privacy page.
- Store consent version, timestamp, state, and source, not just `pm_consent=granted|denied`.
- Make withdrawal as easy as acceptance.
- Name Google as the third party and explain Analytics, Ads conversion measurement, Enhanced Conversions, and offline conversion uploads.
- Avoid saying "no identifiers stored" too broadly unless verified against actual Google tag behaviour and current Consent Mode docs.

> **Action taken**: Partially accepted. We are **not** reverting to Basic Consent Mode — that decision was taken deliberately with the user and stands. Advanced Consent Mode remains. However the "minimum changes either way" list was adopted in full:
>
> - `CONVERSION_TRACKING.md` §8 now defines a `ConsentRecord` (state, version, timestamp, source) stored as JSON in `pm_consent`, replacing the previous flat `granted|denied` cookie.
> - A persistent "Cookie settings" link in the footer re-opens the banner; withdrawal is as easy as acceptance.
> - Consent version is checked on every page load; a bumped version re-prompts the user.
> - §16 rewritten to require the privacy notice to name Google explicitly, describe Advanced Consent Mode behaviour in plain English (cookieless pings on decline, full measurement on accept), and cover the `ad_user_data` consent axis separately.
> - Broad phrases like "no identifiers stored" replaced with accurate wording ("no user identifiers attached; Consent Mode v2 behaviour").

### 4. Gate Enhanced Conversions and offline user identifiers on consent

Risk: High

The plan sends hashed email through browser Enhanced Conversions and may send hashed `user_identifiers` in offline uploads as a fallback.

Why this matters:

Hashed email remains personal data. For Google Ads measurement and Enhanced Conversions, `ad_user_data` consent must be handled explicitly. The Google Ads API supports a `Consent` object on `ClickConversion`; the implementation should use it rather than assuming hashed data is automatically safe.

Recommendation:

- Record `ad_user_data` consent on the lead at submission time.
- Only send `user_data` / hashed email to Google when that consent is granted.
- For offline uploads, send Google Ads API consent fields with the conversion payload.
- If consent is denied, still keep the lead and admin workflow, but do not send hashed email/user identifiers to Google.
- If `gclid`, `gbraid`, or `wbraid` were captured after valid consent, prefer those identifiers over email matching.

Implementation note:

The plan should distinguish:

- Consent for the club to respond to the enquiry.
- Consent for advertising cookies/storage.
- Consent for sending user-provided data to Google for advertising measurement.

Those are related but not identical.

> **Action taken**: Accepted in full.
>
> - `lead` table gains `consent_ad_user_data`, `consent_ad_storage`, `consent_version`, `consent_recorded_at` columns — consent at submission time is frozen on the record.
> - `POST /api/marketing/leads` Zod schema replaces the old boolean `consentGranted` with a structured `consent` object (ad_user_data, ad_storage, version, recordedAt).
> - `§10 Firing` now gates the `user_data` payload on `ad_user_data === 'granted'`; without it, the conversion still fires on gclid alone.
> - `§11 Offline conversion forwarder` adds a per-lead consent-driven behaviour matrix (gclid + hashed email + Consent=granted; gclid only + Consent=denied; or skipped entirely when nothing matchable remains). Google Ads API `ClickConversion.consent` object is set on every upload.
> - Three consent axes (respond / cookie-storage / ad_user_data) documented separately in §16.

### 5. Align offline conversion windows

Risk: Medium

The docs currently mention a 63-day attribution limit, a 60-day admin warning, and 30-day click-through windows in Ads setup.

Recommendation:

- Use one explicit lookback model across the platform and Ads setup.
- For `generate_lead`, 30 days is reasonable.
- For `lead_attended_session` and `lead_became_member`, use a longer window if the real cycle from click to joining often exceeds 30 days.
- If using offline GCLID imports, keep upload timing safely inside Google's retained-click/import limits.
- Make the admin warning derive from the configured conversion-action window, not a hard-coded 60 days.

Suggested wording:

> Admin outcome uploads are attempted only while the original ad click is still inside the configured Google Ads conversion window for that outcome. The UI shows the exact cutoff date per lead.

> **Action taken**: Accepted. `CONVERSION_TRACKING.md` §11 replaces the hard-coded 63/60-day prose with a new "Attribution windows" subsection: click-through window derives from each conversion action's Ads config; upload window capped at 63 days from click; admin UI shows per-lead cutoff as `min(clickThroughWindow, 63 days from first_seen_at)`. `RECRUIT_CAMPAIGN.md` §8 updates offline action setup to 60-day click-through for attended/member (up from "same windows"), reflecting the real funnel.

### 6. Expand landing pages to satisfy destination quality

Risk: Medium

The planned pages are short: hero, shared form, and 2-3 reassurance items.

Why this matters:

Ad Grants website policy expects substantial, original, mission-relevant content, clear mission/activity information, easy navigation, fast/mobile-friendly pages, HTTPS, and limited commercial focus.

Recommendation:

Each landing page should include:

- Who the club is and where it plays.
- Who the session is for.
- Training days/times or seasonal expectation.
- What happens after submitting the form.
- What to bring / experience level needed.
- Coach or team contact context.
- Fees or "trial is free; membership details follow if you decide to join".
- Safeguarding reassurance for junior pages.
- Links to privacy, contact, fixtures/about, and safeguarding policies.

This does not need to be long, but it should be more than a thin lead form.

> **Action taken**: Partially accepted. `RECRUIT_CAMPAIGN.md` §4 restructured to a seven-element page layout: hero, four essential reassurance items (who, when, what to bring, what happens next), a "trial is free" reassurance line, juniors-only safeguarding reassurance + policy link, form headline, the shared lead form, and footer links to about / fixtures / privacy / safeguarding / contact. Middle-ground stance: focused landing page, with mission content reachable through clearly-surfaced site links rather than repeated on every page. Ad Grants website policy evaluates the site as a whole.

### 7. Keep junior data minimised, but do not overbuild safeguarding controls

Risk: Low

Current junior design:

- Parent/guardian is the primary contact.
- Child name is collected.
- Parent/guardian email and optional phone are collected.
- No child contact details are collected.
- Age/school year, medical information, and formal consents are deferred to the existing junior registration flow.

Operating context:

- Single admin.
- Admin is Level 3 qualified Club Safeguarding Officer.

Recommendation:

- Keep the current minimal junior form.
- Add helper copy: "Parent/guardian details only. Please do not include medical or sensitive safeguarding information in this form."
- Keep junior lead access admin-only.
- Do not send child free-text notes into broad Slack channels if other people are later added to `#new-leads`.

No additional safeguarding workflow is required for the current launch.

> **Action taken**: Skipped by decision. The helper copy and single-channel Slack caveat were judged not worth adding — the form is already minimal, junior access is already admin-only, and Slack routing is already a single channel by design. No changes to the docs.

### 8. Fix segment key mismatch

Risk: Low

`CONVERSION_TRACKING.md` shows registry segment keys like `senior_men`, while `RECRUIT_CAMPAIGN.md` defines `senior_men_cricket`, `senior_women_softball_cricket`, etc.

Recommendation:

- Use the campaign document's more explicit keys in the shared registry.
- Add a type-level test that every configured landing page segment resolves to an Ads conversion action.

> **Action taken**: Accepted. `CONVERSION_TRACKING.md` §6 campaign registry example updated to the explicit format-specific keys (`senior_men_cricket`, `senior_women_softball_cricket`, `junior_boys_cricket`, `junior_girls_dynamos_cricket`). A type-level guard (`AssertAllSegmentsHavePrimaryAction`) added to the doc — catches missing conversion-action mappings at compile time rather than runtime.

### 9. Clarify direct marketing posture

Risk: Low

The plan correctly avoids a newsletter checkbox and treats trial follow-up as in-scope service communication.

Recommendation:

- Keep recruitment follow-up limited to the requested trial/session enquiry unless separate marketing permission or a valid charitable-purpose soft opt-in basis is documented.
- If the club later wants newsletters, fundraising, sponsor promotions, or seasonal recruitment emails, add a separate preference model with clear opt-out.
- Update the privacy notice to distinguish service messages from direct marketing.

> **Action taken**: Accepted. `CONVERSION_TRACKING.md` §16 rewritten with an explicit "Service communications vs direct marketing" subsection: responding to a trial enquiry is service communication (in-scope for the form's purpose); newsletters, fundraising asks, seasonal reminders, and sponsor promotions are direct marketing and require their own lawful basis. The privacy notice requirements in §16 include making this distinction in plain English.

---

## Recommended doc changes

### `CONVERSION_TRACKING.md`

- Replace Manual CPC references with an Ad Grants-safe bidding sequence.
- Add consent record fields or a consent audit event.
- Explicitly model `ad_user_data` consent separately from cookie/banner consent.
- Add Google Ads API consent fields to offline conversion upload design.
- Replace the fixed 63/60-day offline window text with per-conversion-action window logic.
- Clarify whether launch uses Basic or Advanced Consent Mode.

### `RECRUIT_CAMPAIGN.md`

- Add the formal Ad Grants compliance checklist.
- Replace Manual CPC launch instructions.
- Add landing page content requirements.
- Align segment keys with the platform registry.
- Add junior form helper text about parent details and no sensitive information.
- Add search-term and Quality Score monitoring to weekly operations.

---

## Launch gate

Do not launch grant traffic until all of these are true:

- Privacy/cookie notice is live and matches actual tag behaviour.
- Consent can be accepted, declined, reopened, and withdrawn.
- Test lead appears in DB and admin.
- Test `generate_lead` appears in GA4 DebugView or Ads diagnostics as expected.
- Ads conversion actions are initially Secondary unless intentionally promoted.
- Campaigns have local geo-targeting, sitelinks, compliant keywords, and at least two ad groups.
- Search terms and Quality Score review owner is assigned.

---

## Official references

- Google Ad Grants account management policy: https://support.google.com/nonprofits/answer/117827
- Google Ad Grants conversion tracking setup: https://support.google.com/nonprofits/answer/9841491
- Google Ad Grants mission-based campaigns: https://support.google.com/nonprofits/answer/4410314
- Google Ad Grants website policy: https://support.google.com/nonprofits/answer/1657899
- Google Ad Grants budgets and bidding: https://support.google.com/nonprofits/answer/1332166
- Google EU User Consent Policy: https://www.google.com/about/company/user-consent-policy.html
- Google Ads Consent Mode updates: https://support.google.com/google-ads/answer/13695607
- Google Ads API offline conversion uploads: https://developers.google.com/google-ads/api/docs/conversions/upload-offline
- ICO PECR storage/access technologies guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-pecr-rules/
- ICO online advertising and storage/access technologies: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/how-do-the-rules-apply-to-online-advertising/
- ICO children's information guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/using-childrens-information-a-guide/
- ECB safeguarding policies: https://www.ecb.co.uk/news/3340261/policies-safeguarding
