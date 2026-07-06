import { z } from "zod";

// Leaf module: the block-type primitives shared by index.ts and
// block-catalog.ts. Kept separate so block-catalog can import the block-type
// names + prop value schema WITHOUT a circular dependency on index.ts (which
// re-exports the catalog). index.ts re-exports both for backward compatibility,
// so external importers still get them from "@percy-main/shared/content".

/** A BlockNote block prop value. All block props are scalar. */
export const blockPropValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

// ── Custom block types ──────────────────────────────────────────────────
//
// The directive vocabulary from the original epic plan, as BlockNote custom
// block type names. Single source of truth shared by the editor (which
// registers blocks under these names), the public renderer (which maps them to
// the component map), and the AI content-author block catalog.
export const CUSTOM_BLOCK_TYPES = {
  person: "person",
  personGrid: "personGrid",
  gamePreview: "gamePreview",
  eventPreview: "eventPreview",
  // Editor-uploaded image. Replaces BlockNote's built-in image block in the
  // editor schema (whose URL-embed tab would bypass the consent + processing
  // pipeline). props.picture carries the JSON-stringified PictureSource
  // descriptor from the upload API so public pages render the responsive
  // ladder without any lookup.
  contentImage: "contentImage",
  // A set of uploaded photos rendered as one main photo above a clickable
  // thumbnail strip. props.images carries a JSON-stringified array of
  // { picture, alt?, caption? } where picture is the upload API's
  // PictureSource descriptor (the contentImage precedent, pluralised).
  photoGallery: "photoGallery",
  leagueTable: "leagueTable",
  leaderboard: "leaderboard",
  recordsWall: "recordsWall",
  // Interactive cricket result blocks for match reports / news. Both read
  // ball-by-ball data from the games API at view time. The wagon wheel plots
  // shot directions (needs shot data); the worm plots cumulative runs (needs
  // only runs per ball).
  wagonWheel: "wagonWheel",
  wormChart: "wormChart",
  contactForm: "contactForm",
  cookieSettingsLink: "cookieSettingsLink",
  consentVersion: "consentVersion",
} as const;
