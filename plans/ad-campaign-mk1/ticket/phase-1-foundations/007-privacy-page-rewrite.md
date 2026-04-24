# 007 — Privacy page rewrite

**Phase**: 1 — Foundations
**Depends on**: 004, 005, 006
**Effort**: M

## Context

Existing privacy page (`apps/web/src/pages/legal/privacy.tsx`, last updated 2025-01-10) is based on the ICO template. For the conversion-tracking rollout it needs: explicit processor list, cookies section, consent mechanism description, and service-vs-marketing distinction.

Must be live **before** Phase 2 (any new data flows).

## Scope

### In

- Update processor list: **remove** Retool; **add** AWS (hosting/db/email/storage), New Relic (monitoring), Better-Auth (cloud auth service), Google Ads (recruitment advertising + conversion measurement), Google Analytics 4 (site analytics), Slack (contact + payment notifications).
- Add a "Cookies" section listing:
  - `pm_consent` — consent record (first-party, 12 months).
  - `pm_attrib` — attribution snapshot (first-party, 90 days, only set after consent granted).
  - Google cookies (`_ga`, `_gid`, `_gcl_au`, etc.) — describe purpose, third-party.
- Add plain-English description of Consent Mode v2 behaviour (see §16 in the design doc).
- Add "Service communications vs direct marketing" section making explicit that responding to a trial form is a service communication, not marketing.
- Inline "Cookie settings" link in the cookies section (re-opens banner via ticket 006 mechanism).
- Bump `CURRENT_CONSENT_VERSION` constant (ticket 004) and note the version in the page footer.
- Update "Last updated" date.

### Out

- International transfer wording beyond a single sentence (defer to legal polish if needed — not a blocker for launch).

## Approach

- Copy draft written collaboratively; match the voice of the existing page (ICO template style, first-person-plural).
- Signoff: Alex Young (tech lead / sole admin); no external legal required.

## References

- [CONVERSION_TRACKING.md §16 Consent, compliance, retention](../../CONVERSION_TRACKING.md#16-consent-compliance-retention)
- [ADS_REVIEW.md Finding 3](../../ADS_REVIEW.md)
- ICO cookie guidance (linked from ADS_REVIEW.md)

## Acceptance

- [ ] Page renders at `/legal/privacy`.
- [ ] All six new processors listed, Retool removed.
- [ ] Cookie table present with purpose + retention.
- [ ] "Cookie settings" link in the cookies section re-opens banner.
- [ ] "Last updated" date reflects publish date.
- [ ] `CURRENT_CONSENT_VERSION` bumped → returning visitors are re-prompted.
- [ ] Signoff recorded (commit message or PR body).
