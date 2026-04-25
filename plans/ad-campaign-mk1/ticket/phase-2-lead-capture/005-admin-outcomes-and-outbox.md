# 005 — Admin lead outcomes + outbox debug view

**Phase**: 2 — Lead capture + admin
**Depends on**: 001, 004
**Effort**: M

## Context

Outcome buttons on each lead row (Contacted / Attended / Joined / Lost) that emit the right events. Plus a read-only outbox debug view for Phase 5 onwards.

## Scope

### In

- `POST /api/admin/leads/:leadId/outcomes`:
  - Body: `{ outcome: 'contacted' | 'attended' | 'joined' | 'lost', notes?, memberId? }`.
  - Emits the matching event via `emitMarketingEvent` (`lead_contacted`, `lead_attended_session`, `lead_became_member`, `lead_lost`).
  - Updates denormalised `lead.status`.
  - For `joined`, optionally sets `lead.member_id` if `memberId` provided.
- Web UI: row action buttons in the leads tab. `Joined` opens a modal to optionally pick a member to link.
- `GET /api/admin/marketing-outbox` — paginated list with status/destination/age filters.
- `POST /api/admin/marketing-outbox/:id/retry` — re-queue a `dead` row.
- `GET /api/admin/marketing-events?leadId=…` — per-lead event timeline (used in the row expansion from ticket 004).
- Outbox admin page: off main admin nav, reachable via direct link; not prominent for day-to-day use.

### Out

- Actual Ads API upload logic (Phase 5 — this ticket just wires the buttons and debug views).

## Approach

- Outcome click → `setLeadStatus()` helper that wraps event emit + status update atomically.
- All admin routes `requireRole('admin')`.

## References

- [CONVERSION_TRACKING.md §9 Admin outcomes endpoint](../../CONVERSION_TRACKING.md#9-public-api-surface)
- [CONVERSION_TRACKING.md §12 Admin surfaces](../../CONVERSION_TRACKING.md#12-admin-surfaces)

## Acceptance

- [ ] Clicking Contacted writes a `lead_contacted` event and bumps `lead.status` to `contacted`.
- [ ] Clicking Joined with a selected member sets `lead.member_id` and emits `lead_became_member`.
- [ ] Event timeline shows all events for the selected lead in chronological order.
- [ ] Outbox view lists all rows with status filter.
- [ ] Manual retry flips a `dead` row back to `pending`.
