# 005 — End-to-end test + dead-letter polish

**Phase**: 5 — Offline forwarder + outcome uploads
**Depends on**: 001, 002, 003, 004
**Effort**: S

## Context

Before leaning on the pipeline for real leads, exercise it end-to-end against a real Ads sandbox (or production with a single test lead). Confirm the dead-letter flow works with a deliberately broken input.

## Scope

### In

- End-to-end run against a real Ads environment:
  1. Submit a test lead via `POST /api/marketing/leads` with a synthetic `gclid` borrowed from a recent real ad click.
  2. Wait for the drain loop to upload.
  3. Verify in Google Ads UI that the conversion arrives and is credited correctly.
  4. Admin marks "Attended" → verify the `lead_attended_session` upload in Ads UI.
- Exercise dead-letter:
  1. Temporarily misconfigure one conversion action resource name (or force a 4xx).
  2. Verify the outbox row lands in `dead` state after the 4xx.
  3. Manually retry via `POST /api/admin/marketing-outbox/:id/retry`.
- Write a short runbook (a markdown file under `plans/ad-campaign-mk1/runbook.md`) describing: how to monitor, what `dead` rows mean, how to retry.

### Out

- Anything in the client/server code paths (built in 001–004).

## Approach

- Keep the test lead traceable (name it "Test Lead — E2E Phase 5") and delete afterwards.
- The runbook should be brief; it'll grow organically as we hit real issues.

## References

- [CONVERSION_TRACKING.md §19 Phase 5 validation gate](../../CONVERSION_TRACKING.md#19-rollout-plan)

## Acceptance

- [ ] One real lead flows end-to-end: Ads conversion appears, matched to the right conversion action.
- [ ] One Attended outcome flows end-to-end for the same lead.
- [ ] Forced 4xx produces `dead` row; manual retry re-queues and can succeed after the fix.
- [ ] Runbook committed.
