import { CUSTOM_BLOCK_TYPES } from "@percy-main/shared/content";
import { fromZonedTime } from "date-fns-tz";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import { markdownToBlocks, type MigrationBlock } from "./markdown-to-blocks.ts";

// One-time inbound migration converter (#491): the legacy MDX news +
// events corpus -> the BlockNote-shaped block document the content API
// stores (ADR 047). Unlike the game reports, this corpus embeds a small
// fixed vocabulary of JSX components (<Image>, <GamePreview>) between
// plain-markdown prose, so the body is segmented first: component
// invocations are found with a regex over the raw source and everything
// between them goes through markdownToBlocks() unchanged.
//
// This is deliberately NOT a general MDX parser. The corpus is 17 files
// written by a handful of people; a regex over the exact constructs they
// used is simpler, auditable, and fails loudly on anything outside the
// vocabulary - which is the correct behaviour for a one-time migration
// (refusing beats silently dropping content).

// ── Segmentation ────────────────────────────────────────────────────────

export type MdxSegment =
  | { kind: "markdown"; text: string }
  | { kind: "component"; name: string; attrs: Record<string, string> };

/** The only components the news/events corpus actually uses. */
const KNOWN_COMPONENTS = new Set(["Image", "GamePreview"]);

/**
 * A self-closing capitalised JSX invocation, possibly spanning lines
 * (the corpus writes <Image> with one attribute per line). The attr
 * chunk alternation permits ">" only inside quoted strings, so the
 * match cannot run past the closing "/>".
 */
const COMPONENT_RE = /<([A-Z][A-Za-z]*)((?:[^>"]|"[^"]*")*?)\/>/g;

/**
 * Attributes are exclusively string literals in this corpus
 * (name="value"). Anything left over after extracting those - a JSX
 * expression attr, an unquoted value - is a hard failure.
 */
export function parseComponentAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g;
  for (const match of raw.matchAll(re)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    attrs[name] = value;
  }
  const leftover = raw.replace(re, "").trim();
  if (leftover !== "") {
    throw new Error(
      `Unparseable component attributes '${leftover.slice(0, 60)}' - migrate this file by hand`,
    );
  }
  return attrs;
}

/**
 * The corpus uses <sup>th</sup>-style ordinal markers in one article.
 * BlockNote has no superscript style, so the tag is deliberately
 * flattened to its plain text ("9<sup>th</sup>" -> "9th") - a purely
 * visual downgrade with no content loss.
 */
function flattenSupTags(text: string): string {
  return text.replace(/<sup>([^<]*)<\/sup>/g, "$1");
}

/**
 * After known components are extracted and <sup> is flattened, any
 * remaining tag-shaped construct or module syntax means the file uses
 * vocabulary this converter does not understand - refuse loudly.
 */
function assertNoLeftoverJsx(text: string): void {
  if (/^\s*(import|export)\s/m.test(text)) {
    throw new Error(
      "MDX import/export statement found - migrate this file by hand",
    );
  }
  const leftover = /<\/?[A-Za-z][^\n]*/.exec(text);
  if (leftover) {
    throw new Error(
      `Unhandled JSX/HTML construct '${leftover[0].slice(0, 60)}' - migrate this file by hand`,
    );
  }
}

/**
 * Split an MDX body into markdown segments and component invocations.
 * Components must be block-level (alone on their lines, as the whole
 * corpus writes them) - an inline invocation would force this code to
 * split a paragraph, so it fails instead.
 */
export function segmentMdx(body: string): MdxSegment[] {
  const segments: MdxSegment[] = [];

  const pushMarkdown = (raw: string) => {
    const text = flattenSupTags(raw).trim();
    if (text === "") return;
    assertNoLeftoverJsx(text);
    segments.push({ kind: "markdown", text });
  };

  let cursor = 0;
  for (const match of body.matchAll(COMPONENT_RE)) {
    const [full, name, rawAttrs] = match;
    if (name === undefined || rawAttrs === undefined) continue;
    if (!KNOWN_COMPONENTS.has(name)) {
      throw new Error(
        `Unknown component <${name}> - migrate this file by hand`,
      );
    }
    const start = match.index;
    const before = body.slice(0, start);
    const after = body.slice(start + full.length);
    if (!/(^|\n)[ \t]*$/.test(before) || !/^[ \t]*(\n|$)/.test(after)) {
      throw new Error(
        `<${name}> used inline within other content - migrate this file by hand`,
      );
    }
    pushMarkdown(body.slice(cursor, start));
    segments.push({
      kind: "component",
      name,
      attrs: parseComponentAttributes(rawAttrs),
    });
    cursor = start + full.length;
  }
  pushMarkdown(body.slice(cursor));

  return segments;
}

// ── Segments -> blocks ──────────────────────────────────────────────────

export interface ImageInvocation {
  src: string;
  alt?: string;
  caption?: string;
}

/**
 * Resolves an <Image> invocation to the contentImage block props the
 * public renderer expects ({ src, alt, caption, picture }). Injected so
 * the migration script owns the sharp/S3 pipeline and tests can stub a
 * picture descriptor.
 */
export type ResolveContentImage = (
  image: ImageInvocation,
) => Promise<Record<string, string>>;

function customBlock(
  type: string,
  props: Record<string, string>,
): MigrationBlock {
  // content: "none" blocks serialise from the editor without a content
  // array, so none is emitted here either.
  return { id: crypto.randomUUID(), type, props, children: [] };
}

/**
 * Convert an MDX news/event body into the block array the content API
 * stores. Markdown segments reuse markdownToBlocks() (and inherit its
 * fail-loudly assertions); component segments map to the custom block
 * types the editor and public renderer share.
 */
export async function mdxToBlocks(
  body: string,
  resolveImage: ResolveContentImage,
): Promise<MigrationBlock[]> {
  const blocks: MigrationBlock[] = [];
  for (const segment of segmentMdx(body)) {
    if (segment.kind === "markdown") {
      blocks.push(...markdownToBlocks(segment.text));
      continue;
    }
    if (segment.name === "GamePreview") {
      const playCricketId = segment.attrs.playCricketId;
      if (!playCricketId) {
        throw new Error("<GamePreview> without playCricketId");
      }
      blocks.push(
        customBlock(CUSTOM_BLOCK_TYPES.gamePreview, { playCricketId }),
      );
      continue;
    }
    // Image - the resolver returns the full prop set so the picture
    // descriptor comes from the same pipeline as editor uploads.
    const { src, alt, caption } = segment.attrs;
    if (!src) throw new Error("<Image> without src");
    const props = await resolveImage({ src, alt, caption });
    blocks.push(customBlock(CUSTOM_BLOCK_TYPES.contentImage, props));
  }
  return blocks;
}

// ── Frontmatter ─────────────────────────────────────────────────────────

function splitFrontmatter(source: string): {
  raw: Record<string, unknown>;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) throw new Error("No frontmatter block");
  const raw: unknown = YAML.parse(match[1] ?? "");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Frontmatter is not a YAML mapping");
  }
  return {
    raw: raw as Record<string, unknown>,
    body: source.slice(match[0].length).trim(),
  };
}

// The yaml package's default (YAML 1.2 core) schema keeps dates and
// ISO datetimes as plain strings, but coerce defensively in case a
// future yaml version resolves them to Date.
const yamlDateString = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString() : v),
  z.string().min(1),
);

const newsFrontmatterSchema = z.object({
  title: z.string().min(1),
  date: yamlDateString.pipe(
    z
      .string()
      // A bare date, or a date with an ISO time suffix (the Date
      // coercion above produces the latter). Anything else - e.g. a
      // typo like '2025-05-13oops' - must fail loudly, not truncate.
      .regex(/^\d{4}-\d{2}-\d{2}(?:T\S+)?$/)
      .transform((v) => v.slice(0, 10)),
  ),
  author: z.string().min(1).optional(),
  slug: z.string().min(1),
  tags: z.array(z.string().min(1)).optional(),
});

export interface NewsSource {
  title: string;
  date: string;
  author?: string;
  slug: string;
  tags: string[];
  body: string;
}

export function parseNewsSource(source: string): NewsSource {
  const { raw, body } = splitFrontmatter(source);
  const fm = newsFrontmatterSchema.parse(raw);
  return {
    title: fm.title,
    date: fm.date,
    ...(fm.author !== undefined && { author: fm.author }),
    slug: fm.slug,
    tags: fm.tags ?? [],
    body,
  };
}

const eventFrontmatterSchema = z.object({
  name: z.string().min(1),
  when: yamlDateString,
  finish: yamlDateString.optional(),
  location: z.string().min(1).optional(),
});

export interface EventSource {
  name: string;
  when: string;
  finish?: string;
  location?: string;
  body: string;
}

export function parseEventSource(source: string): EventSource {
  const { raw, body } = splitFrontmatter(source);
  const fm = eventFrontmatterSchema.parse(raw);
  return {
    name: fm.name,
    when: fm.when,
    ...(fm.finish !== undefined && { finish: fm.finish }),
    ...(fm.location !== undefined && { location: fm.location }),
    body,
  };
}

// ── Event locations ─────────────────────────────────────────────────────

export interface RawLocation {
  name?: string | null;
  street?: string | null;
  city?: string | null;
  postcode?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface EmbeddedLocation {
  name: string;
  street: string;
  city: string;
  postcode: string;
  lat?: number;
  lon?: number;
}

/**
 * Resolve a frontmatter location name against the locations.yaml corpus,
 * embedding only the fields eventMetadataSchema keeps (county/country
 * are deliberately dropped). Returns undefined when nothing matches or
 * the match is missing a required address field.
 *
 * First match wins on duplicate names. Note the web app's
 * getLocationByName builds a Map in file order, so its lookups return
 * the LAST duplicate - for the one duplicated venue ("Tynemouth Social
 * Club") the entries differ only in address formatting, and the first
 * entry has the cleaner data, so first-match is used here.
 */
export function resolveLocation(
  locations: RawLocation[],
  name: string,
): EmbeddedLocation | undefined {
  const match = locations.find((loc) => loc.name === name);
  if (!match?.name || !match.street || !match.city || !match.postcode) {
    return undefined;
  }
  return {
    name: match.name,
    street: match.street,
    city: match.city,
    postcode: match.postcode,
    ...(typeof match.lat === "number" && { lat: match.lat }),
    ...(typeof match.lon === "number" && { lon: match.lon }),
  };
}

/** Names that appear more than once in locations.yaml (data smell). */
export function findDuplicateLocationNames(locations: RawLocation[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const loc of locations) {
    if (!loc.name) continue;
    if (seen.has(loc.name)) duplicates.add(loc.name);
    seen.add(loc.name);
  }
  return [...duplicates];
}

// ── published_at derivation ─────────────────────────────────────────────

/**
 * News frontmatter dates are calendar days with no time or zone; the
 * site's audience is the club's, so "live from" is midnight Europe/London
 * on that day (UTC in winter, UTC+1 in British Summer Time).
 */
export function newsPublishedAt(date: string): Date {
  return fromZonedTime(`${date}T00:00:00`, "Europe/London");
}

/**
 * LEAST(when, now): a past event uses its start time, a future event is
 * visible immediately - the public list filters on
 * published_at <= CURRENT_TIMESTAMP, so using a future `when` would hide
 * the event's page until the event had already started.
 */
export function eventPublishedAt(when: string, now: Date): Date {
  const start = new Date(when);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Unparseable event start '${when}'`);
  }
  return start.getTime() <= now.getTime() ? start : now;
}

// ── Deterministic image ids ─────────────────────────────────────────────

/**
 * Namespace for UUIDv5 image ids, generated once for this migration.
 * Never change it: the derived ids name the S3 variant keys and the
 * content_image rows, so a new namespace would orphan everything
 * already uploaded and re-upload the corpus under fresh keys.
 */
const CONTENT_IMAGE_NAMESPACE = "5f4f6e10-9c39-49dc-92d4-1f1a1f3f9b6a";

/**
 * Deterministic UUIDv5 for a source asset, keyed by its public path
 * (e.g. "/images/contentful/<hash>/<file>"). Re-runs derive the same id,
 * so variant uploads overwrite the same S3 keys and the content_image
 * insert can onConflict-doNothing, mirroring confirmUpload's idempotent
 * shape.
 */
export function imageIdForAsset(publicPath: string): string {
  const namespaceBytes = Buffer.from(
    CONTENT_IMAGE_NAMESPACE.replaceAll("-", ""),
    "hex",
  );
  const hash = createHash("sha1")
    .update(namespaceBytes)
    .update(publicPath, "utf8")
    .digest();
  const bytes = hash.subarray(0, 16);
  // RFC 4122: version 5 in the high nibble of byte 6, variant 10 in the
  // top bits of byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── JSON equality ───────────────────────────────────────────────────────

/**
 * Canonical structural equality for metadata comparisons. Postgres JSONB
 * does not preserve object key order, so keys are sorted before
 * comparison. Unlike blocksEqualIgnoringIds this keeps every key - "id"
 * is not special in metadata.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
