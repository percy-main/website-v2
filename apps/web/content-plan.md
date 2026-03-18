# Content Migration — Remaining Work

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
- ~~Calendar overview (`/calendar`)~~ — Redirects to current month.
- ~~Calendar month (`/calendar/:year/:month`)~~ — Agenda view with games from API + events from MDX, filter pills, mini calendar, month summary.
- ~~Game detail page (`/calendar/game/:id`)~~ — Match details, result, scorecard, MDX report, sponsor, add-to-calendar, map.
- ~~`<GamePreview>`~~ — Inline game card with team, result, link to game detail.
- ~~Game report MDX infrastructure~~ — `content/games/*.mdx` with `playCricketId` frontmatter, indexed by match ID.
- ~~`GET /api/games`~~ — Fixture list from Play Cricket API with in-memory cache, merged with DB results + sponsorships.
- ~~`GET /api/games/:matchId`~~ — Game detail combining API data with DB results, sponsorship, and location.
