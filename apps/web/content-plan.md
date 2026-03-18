# Content Migration — Remaining Work

## Placeholder MDX Components

These render placeholder text and need real implementations:

- **`<LeagueTable>`** — Used on 1st XI, 2nd XI, Midweek XI pages. Needs API call to Play Cricket `getLeagueTable` endpoint.
- **`<Leaderboard>`** — Cricket stats leaderboard. Not currently embedded in any converted page but available for use.
- **`<EventPreview>`** — Inline event card. Not currently embedded in any converted page.
- **`<GamePreview>`** — Inline game card. Not currently embedded in any converted page.
- **`<ContactForm>`** — Used on Charity page. Needs form submission (API endpoint + email).
- **`<CollectEmail>`** — Email signup form. Not currently embedded in any converted page.

## Stub Pages

These routes exist but render only a heading:

- **Person profile** (`/person/:slug`) — Should render bio/photo/qualifications from people MDX files. Data is already available.
- **Calendar overview** (`/calendar`) — Needs games from API + events from MDX.
- **Calendar month** (`/calendar/:year/:month`) — Needs API data.
- **Calendar event** (`/calendar/event/:id`) — Needs event data.
- **Person directory** (`/person`) — Superseded by `/people` content page. Should redirect to `/people`.
- **News by tag** (`/news/tag/:tag/:page`) — Tag filtering is now client-side on `/news/:page`. Should redirect to `/news/1`.

## Quick Wins

- **Person profile page** — Render from people MDX (name, photo, bio, qualifications). All data already converted.
- **Redirect `/person` → `/people`** — One-liner in router.
- **Remove or redirect `/news/tag/:tag/:page`** — Redundant with client-side filtering.
