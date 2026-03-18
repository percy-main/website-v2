# Content Migration — Remaining Work

## Placeholder MDX Components (not currently used)

These are registered but not embedded in any converted page. Implement when needed:

- **`<Leaderboard>`** — Cricket stats leaderboard.
- **`<EventPreview>`** — Inline event card.
- **`<GamePreview>`** — Inline game card.
- **`<CollectEmail>`** — Email signup form.

## Stub Pages

These routes exist but render only a heading:

- **Calendar overview** (`/calendar`) — Needs games from API + events from MDX.
- **Calendar month** (`/calendar/:year/:month`) — Needs API data.
- **Calendar event** (`/calendar/event/:id`) — Needs event data.

## Completed

- ~~`<LeagueTable>`~~ — Implemented, fetches from Play Cricket API.
- ~~`<ContactForm>`~~ — Implemented, POSTs to `/api/contact`.
- ~~Person profile (`/person/:slug`)~~ — Renders from people MDX.
- ~~`/person` → `/people` redirect~~ — Done.
- ~~`/news/tag/:tag/:page` redirect~~ — Redirects to `/news/1`.
