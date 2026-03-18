# Content Migration — Complete

All content has been migrated from Contentful to MDX/API.

- `<LeagueTable>` — Fetches from Play Cricket API.
- `<ContactForm>` — POSTs to `/api/contact` with Input/Textarea/Button UI.
- `<EventPreview>` — Inline event card with calendar icon, date, name, link.
- Event detail page (`/calendar/event/:id`) — Renders event MDX, map, add-to-calendar.
- Event data migration — 3 events converted from Contentful to MDX.
- Person profile (`/person/:slug`) — Renders from people MDX.
- `/person` → `/people` redirect.
- `/news/tag/:tag/:page` redirect — Redirects to `/news/1`.
- Calendar overview (`/calendar`) — Redirects to current month.
- Calendar month (`/calendar/:year/:month`) — Agenda view with games from API + events from MDX.
- Game detail page (`/calendar/game/:id`) — Match details, result, scorecard, MDX report, sponsor, add-to-calendar, map.
- `<GamePreview>` — Inline game card with team, result, link to game detail.
- Game report MDX infrastructure — `content/games/*.mdx` indexed by `playCricketId`.
- `GET /api/games` — Fixture list from Play Cricket API with in-memory cache.
- `GET /api/games/:matchId` — Game detail combining API data with DB results.
- 9 game reports migrated from Contentful to MDX.
