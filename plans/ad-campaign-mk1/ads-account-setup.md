# Google Ads account setup runbook (Phase 4 ticket 001)

Pure ops, mostly Google UIs. Start early — the Ads API developer-token
approval typically takes 2–5 working days.

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

## 3. Apply for Ads API access

- [ ] Google Ads → Admin → API Center → "Apply for API access" → Basic
      access tier (sufficient for our volume).
- [ ] Wait for approval (2–5 working days).
- [ ] Capture the **developer token** when approved.

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
      "customerId": "8821235703"
    }
    `
- [ ] Terraform: extend the API task IAM policy with
      `secretsmanager:GetSecretValue` on this ARN.
- [ ] App config (Phase 5 ticket 001 wires the actual env-var pull): values
      land in `app.config.GOOGLE_ADS_DEVELOPER_TOKEN`,
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
- [ ] Developer token approved + creds in Secrets Manager.
- [ ] Six conversion actions in Secondary column.
- [ ] Four campaigns on Maximize Clicks, geo-targeted to North Tyneside.
- [ ] Sitelinks live.
- [ ] Resource names + conversion labels captured for ticket 003.
