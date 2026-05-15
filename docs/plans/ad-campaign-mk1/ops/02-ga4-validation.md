# GA4 DebugView validation gate (Phase 3 ticket 002)

This is an operational gate, not code. Run this checklist for ~48 hours
of live traffic before promoting anything to Phase 4.

## Setup (one-time, before validation can start)

The gtag block is stripped from `index.html` at build time when
`VITE_GA4_MEASUREMENT_ID` is unset (see `apps/web/vite.config.ts`
`gtagHtmlPlugin`), so until both halves below are done, no GA4 events
fire from production.

1. **Create a GA4 property** in Google Analytics under the same
   Workspace identity that owns the Ads MCC
   (`alex.young@percymain.org`):
   - https://analytics.google.com → Admin → **+ Create** → **Property**
   - Property name: `Percy Main CSC` (or similar). Reporting time
     zone: `(GMT+00:00) United Kingdom`. Currency: GBP.
   - Add a **Web data stream** pointing at `https://www.percymain.org`.
   - Copy the **Measurement ID** (format `G-XXXXXXXXXX` — distinct
     from the legacy `UA-` prefix).

2. **Set the GitHub Actions repo variable** so the next deploy injects
   it into the frontend build:

   ```
   gh variable set GA4_MEASUREMENT_ID --body "G-XXXXXXXXXX"
   ```

   The value is non-sensitive (it's emitted in every visitor's HTML)
   so a _variable_ — not a secret — is the right surface. The
   workflow at `.github/workflows/deploy.yml` already references it
   as `${{ vars.GA4_MEASUREMENT_ID }}` in the `Build frontend` step;
   no workflow change needed.

3. **Trigger a deploy** (push any change to `main`, or re-run the
   most recent successful Deploy workflow with the same SHA).

4. **Verify the tag is live**: view-source on
   `https://www.percymain.org/` should now show
   ```html
   <script
     async
     src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"
   ></script>
   ```
   inside the `<!-- pm-gtag:start -->` ... `<!-- pm-gtag:end -->` block.
   If the entire block is missing, the env var didn't make it into the
   build — re-check step 2.

(Local dev does not need the var. The same Vite plugin keeps the gtag
block out of dev builds when the var is unset, which is the desired
behaviour — no GA4 traffic from local development.)

## DebugView checks (over 48h)

Open GA4 → Admin → DebugView. Filter to your debug device.

- [ ] `generate_lead` events appear after submitting a test lead form (Phase
      8 once landing pages exist; until then, simulate via curl + manual
      browser session that hits a `/tell-me-about/...` URL).
- [ ] `generate_lead` event params include the correct `campaign_id` and
      `segment`.
- [ ] `purchase` events appear after a Stripe success redirect; `currency`
      param is "GBP".
- [ ] `sign_up` events appear after registering with the email flow.
- [ ] Pageview events have sensible `page_location` and `page_path`.

## Consent Mode behaviour

Open in two private windows.

- [ ] Window A: accept cookies on the banner. Trigger an event. The event
      reaches GA4 with full identifiers (cookies set, `_ga` present).
- [ ] Window B: decline cookies on the banner. Trigger the same event. The
      event still reaches GA4 with no client identifier (Consent Mode v2
      cookieless ping).

## Real-time sanity

- [ ] GA4 Realtime → Events shows the same events as DebugView for the
      live property (not just debug mode).
- [ ] No unexpected event names in the last 24h. If any appear, investigate
      before moving on.

## Decision

- [ ] All boxes ticked above.
- [ ] No anomalies for 24 consecutive hours.
- [ ] **Decision recorded**: proceed to Phase 4 (Ads online conversions).

## Cleanup

- [ ] `debug_mode: true` removed from any temporary `gtag('config', ...)`
      lines used during validation.
