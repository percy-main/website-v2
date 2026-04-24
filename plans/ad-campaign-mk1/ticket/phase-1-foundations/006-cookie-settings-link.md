# 006 — Cookie settings link + withdrawal flow

**Phase**: 1 — Foundations
**Depends on**: 004
**Effort**: S

## Context

PECR + Google EU User Consent Policy: withdrawal must be as easy as acceptance. A persistent footer link re-opens the banner so the user can flip their choice at any time.

## Scope

### In

- "Cookie settings" link added to the site footer (existing component), visible on every page.
- Clicking opens the consent banner, regardless of whether it's been dismissed.
- Same link embedded on the privacy page (ticket 007), inline in the cookies section.
- Flipping consent writes a new `ConsentRecord` with `source: "settings-link"` and re-issues `gtag('consent','update', ...)`.
- No page reload needed on flip.

### Out

- Per-axis toggles (still a single Allow/Decline banner).

## Approach

- Simplest implementation: a small pub/sub or context in `consent.ts` that the banner subscribes to and the footer link publishes on.
- E2E smoke test: open banner from footer → click Decline → verify cookie flipped and `gtag` update fired.

## References

- [CONVERSION_TRACKING.md §8 Cookie settings / withdrawal](../../CONVERSION_TRACKING.md#8-consent-consent-mode-v2)

## Acceptance

- [ ] After dismissing the banner, clicking footer "Cookie settings" re-opens it.
- [ ] Flipping from granted → denied writes a new record with `source: "settings-link"` and fires a `gtag('consent','update', ...)` with denied values; no page reload.
- [ ] Footer link keyboard-accessible.
