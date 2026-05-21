# ADR 044: Matchday notification channel modelling

## Status

Accepted

## Context

Issue #379 asked us to add push notifications to the matchday app and let users choose email / push / both per matchday notification (currently only "new availability request" - more to follow).

Three shapes were on the table for storing that preference: a single column per channel on the better-auth `user` table, a fan-out of per-notification-type columns, or a separate `notification_preferences` table keyed 1:1 on user.

The user model is managed by better-auth and its schema is the kind of thing better-auth migrations are allowed to touch. The matchday notification list is going to grow - team-sheet published, expense added, fee owed - and we did not want every new category to require an ALTER TABLE plus a frontend type-rev.

## Decision

A new `notification_preferences` table keyed on `user_id` (cascade-delete, PK is the FK), holding a single `matchday_channel` text column constrained to `'email' | 'push' | 'both'`, default `'email'`. Default at the application layer too: callers that read prefs see `'email'` for users with no row.

Wire shape exposed via `GET/PUT /api/me/notification-preferences` returns `{ matchdayChannel }`. Adding a future category is a column add on the same table plus a new field on the response schema - no migration to the user table, no new endpoint.

## Problem

What forced the decision:

- The notification list is open-ended (#379 hints at it explicitly: "for all matchday notifications, currently just ..."). We need somewhere to grow without renaming.
- The better-auth user table is owned by an upstream library and any column we add lives at our own risk - better-auth's CLI generator does not know about our additions, and renames have bitten the codebase before in places that piggy-backed on it.
- Defaulting to email matters: every existing user must keep getting email out of the box without a backfill step.

## Options considered

1. **Separate `notification_preferences` table** (chosen). One row per user, columns per category. New categories = new column.
2. **Column on the `user` table.** Single join elided, but mutates better-auth's table and would need a new column per category.
3. **JSON column on user or on a prefs row.** Maximally flexible, but loses the CHECK-constraint discipline and we end up validating shape in app code instead of the DB.
4. **Per-notification-type table (notification_preferences with a `category` column, one row per user-category pair).** Most "future-proof" but premature - there is exactly one category today, and an EAV-shaped table makes the trivial "load all my prefs" query a join-then-pivot.

## Rationale

We picked option 1 because it gives us:

- A clean separation from better-auth's owned table. Migrations of `notification_preferences` cannot collide with library upgrades.
- A discrete enum constrained by CHECK at the DB layer (`matchday_channel IN ('email','push','both')`) - the validation is in one place.
- Trivial reads for the current category and a trivial column-add for the next one. Pivoting only becomes worthwhile when we have a handful of categories AND the UI wants to render them generically; we have neither.
- A `DEFAULT_MATCHDAY_CHANNEL` constant in the service that the read path applies when no row exists, so we never have to backfill on day one.

## Rejected alternatives

- **User-table column** - rejected because (a) mutating a better-auth-managed table is a recurring footgun (the `dont_mutate_db_directly` rule in personal memory exists for a reason) and (b) it does not actually save us anything: the read still happens at recipient-resolution time, and we already join across tables there.
- **JSON column** - rejected because we lose the CHECK constraint and the next person reading the code has to read the writer to know what values are valid. The enum is small and stable; the cost of a column-per-category is one migration when we add the second category.
- **EAV-shaped per-category table** - rejected as premature. We would adopt this if/when we have more than ~3 categories AND the matchday UI starts rendering "all your notification settings" generically. Until then, one column per category beats a join.

## Related

- Per [ADR 009](009-dependency-injection.md), the service is a curried factory taking `db` as its first parameter.
- Recipient resolution in `sendAvailabilityNotification` reads prefs by user id in batch via `getNotificationPreferencesByUserIds(db)`. Additional emails (admin-added external addresses) bypass the prefs lookup and always go to email.
