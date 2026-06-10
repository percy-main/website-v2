# Editor spike prototypes (issue #484)

Throwaway standalone prototypes comparing **TipTap** and **BlockNote** as the
WYSIWYG editor for live content editing (epic #479). Not wired into the main
app and not intended to merge - see the issue and the resulting ADR.

Both apps demo the same scenario so they can be compared side by side:

- Basic rich text: bold, italic, headings, lists, links
- One custom directive block: `::person{slug="..."}` rendered in-editor as a
  read-only person card (stand-in for the real `<Person />` MDX component)
- Image insert via file picker / drag-drop with a local object-URL placeholder
  (stand-in for the future S3 upload pipeline)
- Markdown round-trip: live serialised markdown panel, import from markdown,
  and a one-click round-trip fidelity check

The BlockNote app additionally demos the chosen architecture (ADR 047):
editor JSON as the canonical format with markdown derived one-way - see the
"JSON (canonical)" / "Markdown (derived)" tabs.

## Run them

```sh
pnpm install            # from repo root
pnpm --filter @percy-main/proto-tiptap dev      # http://localhost:5275
pnpm --filter @percy-main/proto-blocknote dev   # http://localhost:5276
```

To try on a phone, expose the dev server on the LAN:

```sh
pnpm --filter @percy-main/proto-tiptap dev -- --host
```
