# Content Pages (MDX)

The website has a file-based content page system built on MDX. Content pages are used for static informational pages like club info, codes of conduct, event announcements, and similar prose-heavy pages that don't need dynamic data fetching.

## When to use content pages

Use an MDX content page when:

- The page is primarily static text, images, and links
- It fits naturally into the site's content hierarchy (e.g. under `/cricket/`, `/charity/`)
- It doesn't need authenticated data, API calls, or complex interactive state

Use a React page component (in `apps/web/src/pages/`) instead when the page needs dynamic data fetching, authentication, forms, or significant interactivity.

## File location and URL mapping

Content pages live in `apps/web/content/pages/`. The file path maps directly to the URL:

```
content/pages/cricket/juniors/welcome-2026.mdx  →  /cricket/juniors/welcome-2026
content/pages/charity/_index.mdx                →  /charity
content/pages/cricket/kit-shop.mdx              →  /cricket/kit-shop
```

- `_index.mdx` files represent the directory itself (e.g. `cricket/_index.mdx` → `/cricket`)
- Non-index files use their filename as the URL segment
- The catch-all route in `router.tsx` (`path: "*"`) renders content pages via `content-page.tsx`

## Frontmatter

Every MDX file must have YAML frontmatter:

```yaml
---
title: Page Title
description: "Short description for SEO and document meta."
menuOrder: 3
---
```

| Field         | Required | Description                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| `title`       | Yes      | Page title, shown in breadcrumbs and sidebar nav                                       |
| `description` | No       | Meta description for SEO                                                               |
| `menuOrder`   | No       | Sort order within parent section (default: 99). Lower numbers appear first in sidebar. |
| `isMainMenu`  | No       | If `true`, the page appears in the site's top-level navigation menu                    |

## Navigation and sidebar

Content pages automatically get:

- **Breadcrumbs** — built from the page hierarchy (e.g. Cricket > Juniors > Welcome 2026)
- **Sidebar navigation** — shows sibling and child pages within the same top-level section
- **Mobile sidebar** — collapsible menu on small screens

The navigation tree is derived from the file structure. Pages are sorted by `menuOrder` within each level.

## Available MDX components

These components are available in any MDX file without importing:

| Component        | Props                     | Description                                          |
| ---------------- | ------------------------- | ---------------------------------------------------- |
| `<Person>`       | `slug`, `role?`           | Person card with photo, name, role, and profile link |
| `<PersonGrid>`   | `slugs?`, `children?`     | Grid layout for multiple Person cards                |
| `<LeagueTable>`  | `divisionId`, `name?`     | Fetches and renders a league table from Play-Cricket |
| `<Leaderboard>`  | —                         | Season batting/bowling leaderboard                   |
| `<RecordsWall>`  | —                         | Club records display                                 |
| `<EventPreview>` | `id`, `name`, `when`      | Event card linking to calendar                       |
| `<GamePreview>`  | `playCricketId`           | Match card with result and link                      |
| `<ContactForm>`  | `title?`, `description?`  | Contact form that posts to `/api/contact`            |
| `<Image>`        | `src`, `alt?`, `caption?` | Optimised image with optional caption                |

Standard markdown images (`![alt](src)`) are also routed through the optimised image pipeline.

## Writing content

- Use standard markdown for headings, lists, tables, links, bold/italic
- Internal links use root-relative paths: `[privacy policy](/legal/privacy)`
- Email links: `[juniors@percymain.org](mailto:juniors@percymain.org)`
- External links use full URLs: `[kit shop](https://kit.percymain.org)`
- MDX components can be used inline alongside markdown

## Example page

```mdx
---
title: Welcome to Junior Cricket 2026
description: "Junior cricket info for the 2026 season."
menuOrder: 0
---

## Training Times

| Group     | Day     | Time            |
| --------- | ------- | --------------- |
| Boys U11s | Tuesday | 4.30pm - 5.45pm |

[Register here](/membership/junior) to sign up.

##### Coaching Team

<PersonGrid>
  <Person slug="tony-robson" role="Head Of Junior Section" />
</PersonGrid>

<ContactForm title="Get in Touch" />
```

## Adding a new content page

1. Create a `.mdx` file in the appropriate directory under `apps/web/content/pages/`
2. Add frontmatter with at least `title`
3. Write content using markdown and the available MDX components
4. The page is immediately available at the corresponding URL — no router changes needed
5. No build step or code generation required
