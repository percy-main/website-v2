# 004 — Admin leads tab (list + filters + search)

**Phase**: 2 — Lead capture + admin
**Depends on**: 001, 003
**Effort**: M

## Context

Replaces the read-only `contacts-tab.tsx`. Shows every lead from any source with filters for campaign/segment/status/date, search by name/email, and (in the next ticket) outcome action buttons.

## Scope

### In

- `GET /api/admin/leads` endpoint:
  - Query params: `page`, `pageSize`, `search`, `campaignId`, `segment`, `status`, `source`, `from`, `to`.
  - Returns `{ items: Lead[], total: number }` where Lead includes recent event summary.
  - `requireRole('admin')`.
- `apps/web/src/pages/admin/leads-tab.tsx` — renamed / extended from `contacts-tab.tsx`:
  - Paginated table with the fields above.
  - Filter controls: campaign dropdown (from registry), segment dropdown (dynamic per campaign), status dropdown, date range, search.
  - Row click expands to show the full event timeline for that lead.
- Preserve backward-compat: legacy `contact_submission` rows surface as leads with `source: 'contact_form'` (app-level view, not a schema migration).

### Out

- Outcome action buttons (ticket 005).
- Editing lead fields.
- CSV export.

## Approach

- Admin endpoints live in `apps/api/src/features/admin/routes.ts` as per existing convention.
- Use react-query on the web side, as every other admin page does.
- Kysely joins: left join `marketing_event` with a LATERAL for most-recent event per lead.

## References

- [CONVERSION_TRACKING.md §12 Admin surfaces](../../CONVERSION_TRACKING.md#12-admin-surfaces)

## Acceptance

- [ ] `GET /api/admin/leads` paginates and filters correctly.
- [ ] Legacy contact submissions appear in the list.
- [ ] Admin-only (403 for non-admin roles).
- [ ] OpenAPI types regenerated; frontend uses typed client.
