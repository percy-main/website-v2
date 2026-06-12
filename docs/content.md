# Content Pages

All public content - pages, news, events, people profiles and game
reports - is DB-backed and served by the content API (`/api/content/*`).
The canonical body format is a BlockNote-shaped JSON block document
(ADR 047); there is no markdown or MDX anywhere in the pipeline.

## Authoring

Content is created and edited in the admin content editor
(`/admin?section=content`). The editor canvas is the live preview - what
you type is what the public page renders. Publishing, scheduling,
revision history and takedowns are all handled there.

The block vocabulary (headings, lists, tables, images, person grids,
contact forms, league tables, etc.) is documented in
[`content-blocks.md`](./content-blocks.md).

## Rendering

The public site fetches content through the typed API client and
renders it with `ContentBody`
(`apps/web/src/components/content-body.tsx`). Pages hang off a
hierarchy (`parent_id`/`path`); the site nav, breadcrumbs and sidebar
are derived from `GET /api/content/nav`. Unknown paths 404; a `410
Gone` response marks a deliberate takedown.

Heading blocks render with GitHub-style slugified `id` attributes, so
in-page tables of contents can link to `#section-name` fragments.

## History

The corpus originated in Contentful, was migrated to in-repo MDX
(see [`migration-status.md`](./migration-status.md)), and then to the
database during the live content editing project (epics #488, #492,
#497; cleanup #517). The one-off migration scripts lived in
`apps/api/scripts/` and were removed once the prod migration was
verified - see git history if they're ever needed again.
