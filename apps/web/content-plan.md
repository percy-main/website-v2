# Content Migration — Remaining Work

## Deferred to next PR

- **Calendar overview** (`/calendar`) — Needs games from API + events from MDX.
- **Calendar month** (`/calendar/:year/:month`) — Needs API data.
- **`<GamePreview>`** — Inline game card, depends on calendar/games work.

## Placeholder MDX Components (not currently used)

- **`<Leaderboard>`** — Cricket stats leaderboard. Not embedded in any page.

## Completed

- ~~`<LeagueTable>`~~ — Fetches from Play Cricket API.
- ~~`<ContactForm>`~~ — POSTs to `/api/contact` with Input/Textarea/Button UI.
- ~~`<EventPreview>`~~ — Inline event card with calendar icon, date, name, link.
- ~~Event detail page (`/calendar/event/:id`)~~ — Renders event MDX, map, add-to-calendar.
- ~~Event data migration~~ — 3 events converted from Contentful to MDX.
- ~~Person profile (`/person/:slug`)~~ — Renders from people MDX.
- ~~`/person` → `/people` redirect~~ — Done.
- ~~`/news/tag/:tag/:page` redirect~~ — Redirects to `/news/1`.
