# Decision 047: Content Editor - BlockNote with Editor JSON as the Canonical Format

**Date:** 2026-06-10
**Status:** Accepted

## Decision

The live content editing project (#479) will build its editor on **BlockNote**
(`@blocknote/core` / `@blocknote/react`), and the canonical body format
becomes the **BlockNote editor JSON document** stored as JSONB, not GFM
markdown + directives as planned in the epic. Markdown's only remaining role
is as the inbound format for the one-time migration of the existing MDX
corpus; after that, nothing in the system stores, derives, or serves markdown.
Revisions are compared by rendering the content before/after through the same
component mapping, not by diffing text.

This exercises the fallback the epic had already agreed ("if WYSIWYG
round-trip proves lossy, store editor JSON canonically and derive markdown") -
not because round-trip was impossible, but because the editor with the best
authoring UX treats markdown as lossy interchange, and authoring UX is the
project's defining requirement.

## Problem

Phase 1 needs an editor that a team captain on a phone or an ageing laptop can
use without seeing syntax: bold/italic/headings/lists/links, image upload, and
"insert a player card" as a visual block. Issue #484 timeboxed a spike
prototyping the two shortlisted libraries. Both prototypes live in
`apps/proto/` on the spike branch (`spike/editor-prototypes-484`, deliberately
unmerged - see the README there for how to run them).

The spike surfaced a direct conflict between the two top candidates: the
editor with markedly better out-of-box UX for non-technical users (BlockNote)
is also the one that cannot round-trip the planned canonical markdown format
faithfully. One of the two had to give, and the tech lead chose to keep the
UX and change the storage format.

## Options considered

### BlockNote + JSON canonical (chosen)

Notion-style block editor on ProseMirror/TipTap. The spike prototype
(`apps/proto/blocknote`) demonstrated:

- **Best authoring UX with near-zero code.** Slash menu, drag handles, block
  side menu, and an image block with an `uploadFile` hook all work out of the
  box; the custom person block slotted into the slash menu cleanly and
  renders the real card read-only in-editor. Mobile experience is polished
  without any work. Judged substantially better than the TipTap prototype
  for the captain-on-a-phone persona.
- **JSON canonical is trivial.** The custom person block is first-class data
  (`{ "type": "person", "props": { "slug": "alex-slaven" } }`); storing and
  reloading the document is lossless by construction, with no serialisation
  mapping at all.
- **One-time inbound migration works.** `tryParseMarkdownToBlocks` plus a
  directive-paragraph-to-person-block mapping imported the sample report
  cleanly; the 10 legacy game reports migrate this way once.

### TipTap v3 + markdown canonical (rejected)

ProseMirror extension framework, prototyped in `apps/proto/tiptap`:

- **Lossless markdown round-trip** via the official `@tiptap/markdown`
  extension - per-node tokenizer/parse/render hooks made the `::person`
  directive round-trip byte-identical. This would have kept the epic's
  markdown-canonical architecture unchanged.
- **All editing chrome is DIY.** The prototype's toolbar is hand-built;
  slash menu, drag handles, link editing, and mobile affordances would all be
  assembled from primitives and styled by us. The spike's hand-built toolbar
  was judged a substantially worse authoring experience than BlockNote's
  defaults, and closing that gap is exactly the UI engineering this project
  wanted to avoid spending volunteer time on.
- Smaller bundle (215 kB vs 576 kB gzip JS in the prototypes) and MIT
  licence - real advantages, but they accrue mostly to the admin editor
  route, which will be lazy-loaded either way.

## Rationale

The target user is the whole point of the project: a non-technical committee
member or captain who currently cannot publish at all. The spike put both
editors in front of the tech lead and the BlockNote authoring experience was
judged substantially better - and that gap is BlockNote's core product,
not something a few weeks of our UI work reliably replicates.

What BlockNote gives up - faithful markdown round-trip - only matters if
markdown is the storage format. The epic had already pre-agreed JSON-canonical
as the fallback architecture, so the storage format bent rather than the UX:

- **Storage**: `content_item` body becomes the Zod-validated BlockNote block
  array in JSONB (the epic already planned JSONB metadata; this extends the
  approach to the body).
- **Rendering**: public pages render the JSON block tree through our own
  React component mapping (reusing the existing `Person`, image, etc.
  components). The BlockNote runtime is **not** loaded on public pages - the
  JSON is plain data. With no raw-HTML node type in the mapping, output stays
  sanitised by construction, preserving the epic's security property.
- **Revisions**: `content_revision` stores the JSON. Revision comparison is
  render-before/after through the renderer - textual diffs were considered
  and dropped as not a real requirement, which removes the only reason to
  derive markdown from the editor document. (The spike did prove derived
  markdown is feasible via `blocksToMarkdownLossy` plus a person-block
  mapping, should an export need ever appear.)
- **Migration**: legacy MDX reports go through the spike's
  markdown-to-blocks import once; markdown then ceases to be used at all.

Costs accepted, explicitly:

- **Bundle**: the editor chunk is ~2.7x TipTap's (576 kB gzip JS in the
  prototype). Mitigation: the editor loads only on admin editing routes via a
  lazy-loaded chunk. The public-site bundle is unaffected because rendering
  does not use BlockNote.
- **Licence**: core BlockNote packages are **MPL-2.0** (the planning note in
  #484 saying "core MIT" was wrong). Fine for unmodified dependency use.
  The `@blocknote/xl-*` packages are AGPL/commercial and **must not be
  imported** - watch for this in review, since they live in the same npm
  namespace.
- **A custom renderer must be built** (#486): the JSON-to-React mapping for
  public pages is new work that the markdown-canonical plan would have
  avoided (it reused react-markdown). It is straightforward tree-walking
  over a Zod-validated structure, and it removes the directive
  parse/serialise layer entirely, so net effort is roughly a wash.
- **Styling**: the prototype uses `@blocknote/mantine`, which ships Mantine
  alongside our Tailwind/shadcn stack. `@blocknote/shadcn` exists and should
  be evaluated first during build-out.

## Rejected alternatives

- **TipTap + markdown canonical** - rejected because its authoring UX must be
  built by hand, and the UX is the requirement that matters most. Would
  become attractive if BlockNote's abstraction proves too rigid during
  build-out (BlockNote is built on TipTap, so it remains the escape hatch -
  custom block code and the ProseMirror schema knowledge transfer).
- **BlockNote + markdown canonical** - rejected: BlockNote's markdown export
  is lossy by design (`blocksToMarkdownLossy`), has no extension hook for
  custom-block markdown (the spike had to bolt regex pre/post-processing
  around the editor), and normalises formatting on import, which would
  rewrite migrated reports and pollute every revision diff.
- **Markdown + directives as canonical format generally** (the epic's
  original plan) - superseded for content bodies by this ADR. The directive
  vocabulary survives conceptually: each directive becomes a custom block
  type, and the renderer maps block types to the same component map.
