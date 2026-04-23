---
name: add-content-page
description: Add a static MDX content page (club info, codes of conduct, announcements) — file-based routing with frontmatter, no router changes or API code required.
metadata:
  tags: mdx, content, frontend, docs
---

# Add Content Page

Create a static, prose-heavy page using the MDX content system. No router changes, no OpenAPI regeneration — the file path becomes the URL.

## When to Use

- Adding informational pages: club info, codes of conduct, charity pages, announcements
- Pages that are mostly static text + images + links, with no authenticated data or complex state

**Do not use** when the page needs API calls, forms, authentication, or significant interactive state. Use a React page component in `apps/web/src/pages/` instead.

## Full reference

The full spec is in [`docs/content.md`](../../../docs/content.md): file location, URL mapping, available frontmatter fields, available MDX components, navigation/sidebar behaviour. Read that file before authoring a page.

## Quick workflow

1. Decide the URL and map it to a file path under `apps/web/content/pages/`. Example: `/cricket/kit-shop` → `apps/web/content/pages/cricket/kit-shop.mdx`. Use `_index.mdx` for directory-level pages.
2. Add required frontmatter — at minimum `title`. Add `description`, `menuOrder`, `isMainMenu`, `hideTitle` as needed (see `docs/content.md`).
3. Write the content. Use the available MDX components listed in `docs/content.md` rather than inventing new ones.
4. Commit. Navigation and breadcrumbs are derived automatically from the file structure and frontmatter.

## Verification

Start the frontend dev server and visit the URL:

```sh
pnpm run dev:web
```

Check that the page renders, breadcrumbs are correct, and the sidebar includes it in the expected position.
