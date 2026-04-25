# Google Ads account setup runbook (Phase 4 ticket 001)

Pure ops, mostly Google UIs. Start early — even with the new
auto-issue flow, full Basic/Standard access still goes through manual
review.

Customer ID: `882-123-5703` (Ad Grants account, $10k/month notional).
Sole admin today: `alex.young@percymain.org`.

## 1. Add a second admin (bus-factor fix)

Per CONVERSION_TRACKING.md §21. Pick another trustee.

- [ ] Google Ads → Admin → Access and security → Users → Add user.
- [ ] Role: Admin.
- [ ] Confirm 2FA on the trustee's Google account before issuing access.

## 2. Enable auto-tagging

- [ ] Google Ads → Admin → Account settings → Auto-tagging → on. Confirms
      `{gclid}` will be appended to every ad URL automatically.

## 3. Get a Google Ads API developer token

The procedure changed in early 2026. There is no longer a single "Apply
for API access" button on a regular Ads account. The API Center is only
available on a **manager (MCC) account**, and the developer token is
auto-issued at one of two starting tiers based on your form answers.

### 3a. Create a Google Ads manager (MCC) account

A regular Ads account does not have an API Center. The Ad Grants
account `882-123-5703` cannot be used directly to issue a token.

- [ ] Visit https://ads.google.com/intl/en_uk/home/tools/manager-accounts/
      and create a new manager account from the same Google Workspace
      identity that owns the Ad Grants account
      (`alex.young@percymain.org`).
- [ ] Name it `Percy Main CSC — Manager`.
- [ ] Link the existing Ad Grants account `882-123-5703` underneath it
      (Manager → Sub-account-settings → Link existing account → enter
      the customer ID; accept the link from the Ad Grants account
      side). Putting the manager at the root of the hierarchy makes
      the eventual Basic-access review cleaner.

### 3b. Apply for the developer token

- [ ] Sign in to the **manager account** at
      https://ads.google.com/aw/apicenter (or Admin → API center on
      the manager account).
- [ ] Complete the **API Access form**. Use the API contact email
      `alex.young@percymain.org` — Google's API compliance team may
      reach out for clarification.
- [ ] Accept the Terms and Conditions.
- [ ] On submit, the token is auto-issued at one of two tiers:
  - **Explorer Access** ("Approved") — production calls allowed with
    rate limits. Sufficient to run our offline conversion uploader at
    expected volume (tens of conversions/day) and to start Phase 5
    end-to-end testing immediately.
  - **Test Account Access** ("Pending Approval") — you can call the
    API but only against test accounts. Production calls fail with
    `authorization_error: developer token is only approved for use
with test accounts`. If you land here, you can still use the
    token for the Phase 5 sandbox E2E run; production-scale uploads
    wait on review (typical 5–14 business days).
- [ ] Capture the **developer token** (22-char alphanumeric string)
      shown on the API Center page.

### 3c. Apply for Basic Access (only if needed)

If we hit Explorer Access rate limits or get stuck on Test Account
Access, formally apply for Basic Access:

- [ ] In API Center, click the dropdown next to the access level →
      **Apply for Basic Access**.
- [ ] Provide accurate company details and a regularly-monitored
      contact email.
- [ ] **Intended use ("permissible use") → "Ad creation /
      management"**. Why: the actual API surface we use is
      `ConversionUploadService.uploadClickConversions`, which is not
      named in any of the three permissible-use descriptions. The
      "Reporting" option is read-only (`GoogleAdsService.Search` /
      `SearchStream` only) — that doesn't cover writes, so it's the
      wrong choice. "Researching keywords" is irrelevant. "Ad creation
      / management" covers "all services of the API" and is the
      umbrella permission that includes conversion uploads.
- [ ] Application body, suggested wording: _"Single registered
      charity (Percy Main CSC, charity 1206787) running Google Ad
      Grants recruitment campaigns. We use the Google Ads API only to
      upload offline conversions back to our own Ad Grants account
      (`ConversionUploadService.uploadClickConversions`) when admins
      mark a lead as Attended Session or Became Member. No third-party
      ad management, no agency model, no resale. Expected volume: tens
      of conversions per day at peak season."_
- [ ] Wait for review (~2 business days per Google's docs). Basic
      Access raises the daily operations cap to 15,000 — well above
      anything recruit-2026 will need.

Note on permissible use: the field only appears for Basic and Standard
applications. Test Account Access and Explorer Access do not require
an intended-use selection.

## 4. Create the GCP project

- [ ] Cloud console → New project: `percy-main-marketing` under the
      Workspace org.
- [ ] Enable Google Ads API on the project.

## 5. OAuth2 client + refresh token

- [ ] Cloud console → APIs & services → Credentials → Create OAuth client
      ID (Desktop app).
- [ ] Capture **client ID** and **client secret**.
- [ ] Use the OAuth playground (https://developers.google.com/oauthplayground/)
      with the saved client to generate a **refresh token** tied to
      `alex.young@percymain.org`. Scope: `https://www.googleapis.com/auth/adwords`.

## 6. Store creds in AWS Secrets Manager

Same pattern as the existing Stripe/SES secrets.

- [ ] Secret name: `percy-main/google-ads`.
- [ ] Secret JSON shape:
      `json
{
  "developerToken": "...",
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "...",
  "customerId": "8821235703",
  "loginCustomerId": "<manager-account-customer-id>"
}
`
      `customerId` is the operating account (the Ad Grants account
      that runs the campaigns). `loginCustomerId` is the manager
      account from step 3a — required when calling the API on a
      managed (sub-)account.
- [ ] Terraform: extend the API task IAM policy with
      `secretsmanager:GetSecretValue` on this ARN.
- [ ] App config (Phase 5 ticket 001 wires the actual env-var pull):
      values land in `app.config.GOOGLE_ADS_DEVELOPER_TOKEN`,
      `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`,
      `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`,
      `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`.

## 7. Create six conversion actions (Secondary column)

Per RECRUIT_CAMPAIGN.md §8 step 2. **All start in Secondary** — Phase 6
promotes generate_lead to Primary after validation.

| Action name                                               | Window              | Count         | Value    |
| --------------------------------------------------------- | ------------------- | ------------- | -------- |
| `recruit-2026 / Generate Lead / Men's Cricket`            | 30d click + 1d view | one per click | £0       |
| `recruit-2026 / Generate Lead / Women's Softball Cricket` | 30d click + 1d view | one per click | £0       |
| `recruit-2026 / Generate Lead / Junior Boys Cricket`      | 30d click + 1d view | one per click | £0       |
| `recruit-2026 / Generate Lead / Junior Girls Dynamos`     | 30d click + 1d view | one per click | £0       |
| `recruit-2026 / Attended Session`                         | 60d click + 1d view | every         | £0       |
| `recruit-2026 / Became Member`                            | 60d click + 1d view | every         | £50 flat |

For each, capture:

- The full **resource name** (`customers/<id>/conversionActions/<id>`).
- The **conversion label** (the short tag used in `send_to`).

These go into the campaign registry via Phase 4 ticket 003.

## 8. Create four campaigns (one per segment)

- [ ] Search-only.
- [ ] Bidding: **Maximize Clicks** (Ad Grants-safe bootstrap; Phase 6
      switches to Maximize Conversions).
- [ ] Geo-targeting: NE27 + NE28 + NE29 + NE30 + 10–15 mile radius around
      the ground (confirm exact polygon at setup).
- [ ] Budget: set high enough not to throttle delivery — Grants accounts
      rarely exhaust the cap.

## 9. Sitelinks (account-level, ≥4)

Per RECRUIT_CAMPAIGN.md §9 starter list.

- [ ] About — links to `/`
- [ ] Fixtures — links to `/calendar`
- [ ] Safeguarding — links to the safeguarding policy URL
- [ ] Contact — links to `/contact`

## Acceptance

- [ ] Second admin added.
- [ ] Auto-tagging on.
- [ ] Manager (MCC) account created and Ad Grants account linked
      under it.
- [ ] Developer token issued (Explorer Access is sufficient to start;
      Basic Access can follow if needed) and creds in Secrets Manager,
      including `loginCustomerId`.
- [ ] Six conversion actions in Secondary column.
- [ ] Four campaigns on Maximize Clicks, geo-targeted to North
      Tyneside.
- [ ] Sitelinks live.
- [ ] Resource names + conversion labels captured for ticket 003.
