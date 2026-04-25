# 003 — (Deferred) Google Tag Gateway / server-side GTM evaluation

**Phase**: 7 — Operational polish
**Depends on**: —
**Effort**: L (when picked up)
**Status**: **Deferred** — not on current roadmap. Write up for the record.

## Context

Both options give first-party delivery of the Google tag (improved ad-blocker resilience + first-party cookies). Not worth the operational cost at launch volume; revisit when we have real traffic data.

- **Google Tag Gateway** — GCP-managed CDN in front of `gtag.js`. Minimal infra: one GCP config + CNAME. Lowest effort, gets most of the first-party benefit.
- **Server-side GTM** — full sGTM container on Cloud Run (minimum 3 instances for redundancy per Google). More power, more infra, more cost.

## Trigger to pick up

- Ad-blocker-driven data loss exceeds ~10% (measured via DB-vs-Ads reconciliation).
- Traffic grows enough that sGTM's data-enrichment / routing powers are useful.
- Club decides to run non-Google ads (Meta, LinkedIn) — sGTM justifies its keep at that point.

## Scope (when/if picked up)

- If **Tag Gateway**:
  - Set up a subdomain (`tag.percymain.org`), point CNAME at the gateway per Google docs.
  - Update `gtag.js` src in `index.html` to the first-party domain.
  - Done.
- If **sGTM**:
  - Provision in the `percy-main-marketing` GCP project.
  - Stand up ≥3 Cloud Run instances.
  - Migrate tag configuration.
  - Budget for ongoing GCP cost.

## References

- [CONVERSION_TRACKING.md §20 What's explicitly deferred](../../CONVERSION_TRACKING.md#20-whats-explicitly-deferred)
