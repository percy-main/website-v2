# GA4 DebugView validation gate (Phase 3 ticket 002)

This is an operational gate, not code. After Phase 3 ticket 001 ships and
`VITE_GA4_MEASUREMENT_ID` is set, run this checklist for ~48 hours of live
traffic before promoting anything to Phase 4.

## Pre-flight

- [ ] GA4 property exists in `alex.young@percymain.org` Google Workspace.
- [ ] Measurement ID set in:
  - [ ] Local `.env`
  - [ ] GitHub Actions deploy secret
  - [ ] ECS task definition (production env)
- [ ] First post-deploy build verified: view-source on a live page shows
      `<script src="...gtag/js?id=G-XXXX">` and the inline consent default
      stub.

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
