import { mdxComponents } from "@/components/mdx-components.js";
import {
  OptimisedImage,
  type PictureSource,
} from "@/components/optimised-image.js";
import { parsePersonGridEntries } from "@/lib/person-grid.js";
import { cn } from "@/lib/utils.js";
import {
  contentBodySchema,
  CUSTOM_BLOCK_TYPES,
  type ContentBlock,
} from "@percy-main/shared/content";
import { createElement, Fragment, type ReactNode } from "react";

// Renders DB-backed content: the BlockNote editor JSON document (ADR 047),
// walked as plain data - the BlockNote runtime is never loaded on public
// pages. Custom blocks resolve against the same component map MDX uses, so
// migrated content looks identical. There is deliberately no block type
// that emits raw HTML: everything renders through React elements, so
// output is sanitised by construction. Unknown or malformed block types
// render nothing rather than crashing the page.

// ── Inline content ──────────────────────────────────────────────────────

interface StyledText {
  type: "text";
  text: string;
  styles?: Record<string, unknown> | null;
}

interface InlineLink {
  type: "link";
  href: string;
  content: unknown;
}

function isStyledText(node: unknown): node is StyledText {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "text" &&
    typeof (node as { text?: unknown }).text === "string"
  );
}

function isInlineLink(node: unknown): node is InlineLink {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "link" &&
    typeof (node as { href?: unknown }).href === "string"
  );
}

/**
 * Only protocols/paths we trust ever become anchors. Anything else (e.g.
 * javascript:) renders as its text content with no link.
 */
function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href) || /^\/(?!\/)/.test(href);
}

/**
 * Stricter than isSafeHref: images render only from https or
 * site-relative paths (uploads live under /uploads/*). Keeps plain-http
 * mixed content and protocol oddities out of public pages.
 */
function isSafeImageSrc(src: string): boolean {
  return /^https:/i.test(src) || /^\/(?!\/)/.test(src);
}

function StyledTextView({ node }: { node: StyledText }) {
  let element: ReactNode = node.text;
  // A text node with absent/null styles is still renderable text.
  const styles = node.styles ?? {};
  // textColor / backgroundColor are deliberately not honoured: editor
  // content stays within the site palette.
  if (styles.code === true) element = <code>{element}</code>;
  if (styles.bold === true) element = <strong>{element}</strong>;
  if (styles.italic === true) element = <em>{element}</em>;
  if (styles.underline === true) element = <u>{element}</u>;
  if (styles.strike === true) element = <s>{element}</s>;
  return element;
}

/**
 * Inline node arrays carry no ids, so position is the only available key.
 * That is safe here: this tree is a pure projection of immutable data
 * (no element state), and a content change replaces the whole document.
 */
function InlineContent({ content }: { content: unknown }) {
  if (!Array.isArray(content)) return null;
  return content.map((node, i) => {
    const key = `inline-${String(i)}`;
    if (isStyledText(node)) {
      return (
        <Fragment key={key}>
          <StyledTextView node={node} />
        </Fragment>
      );
    }
    if (isInlineLink(node)) {
      const inner = <InlineContent content={node.content} />;
      if (!isSafeHref(node.href)) return <span key={key}>{inner}</span>;
      return (
        <a key={key} href={node.href}>
          {inner}
        </a>
      );
    }
    return null;
  });
}

/** Plain-text projection of inline content (for code blocks, alt text). */
function inlineToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((node) => {
      if (isStyledText(node)) return node.text;
      if (isInlineLink(node)) return inlineToText(node.content);
      return "";
    })
    .join("");
}

// ── Block helpers ───────────────────────────────────────────────────────

const ALIGN_CLASSES: Record<string, string> = {
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

function alignClass(block: ContentBlock): string | undefined {
  const alignment = block.props.textAlignment;
  return typeof alignment === "string" ? ALIGN_CLASSES[alignment] : undefined;
}

function stringProp(block: ContentBlock, name: string): string | undefined {
  const value = block.props[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Parse a JSON-stringified PictureSource, rejecting anything whose URLs
 * fail the image-source check (the descriptor is stored content too).
 */
function parsePicture(raw: string | undefined): PictureSource | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const candidate = parsed as {
    sources?: unknown;
    img?: { src?: unknown; w?: unknown; h?: unknown };
  };
  if (
    typeof candidate.img?.src !== "string" ||
    !isSafeImageSrc(candidate.img.src) ||
    typeof candidate.img.w !== "number" ||
    typeof candidate.img.h !== "number" ||
    typeof candidate.sources !== "object" ||
    candidate.sources === null
  ) {
    return undefined;
  }
  const sources: Record<string, string> = {};
  for (const [format, srcset] of Object.entries(candidate.sources)) {
    if (typeof srcset !== "string") return undefined;
    // Every URL in the srcset must individually be a safe image source.
    const urls = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]);
    if (!urls.every((u) => u !== undefined && isSafeImageSrc(u))) {
      return undefined;
    }
    sources[format] = srcset;
  }
  return {
    sources,
    img: {
      src: candidate.img.src,
      w: candidate.img.w,
      h: candidate.img.h,
    },
  };
}

/** Nested children of a non-list block render indented beneath it. */
function BlockChildren({ block }: { block: ContentBlock }) {
  if (block.children.length === 0) return null;
  return (
    <div className="ml-4">
      <BlocksView blocks={block.children} />
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────
//
// BlockNote table content: { type: "tableContent", rows: [{ cells }] }
// where each cell is either an inline-content array (older shape) or a
// { type: "tableCell", content } object.

function TableCellContent({ cell }: { cell: unknown }) {
  if (Array.isArray(cell)) return <InlineContent content={cell} />;
  if (
    typeof cell === "object" &&
    cell !== null &&
    (cell as { type?: unknown }).type === "tableCell"
  ) {
    return <InlineContent content={(cell as { content?: unknown }).content} />;
  }
  return null;
}

/** Row/cell position keys are safe for the same reason as inline keys. */
function TableView({ block }: { block: ContentBlock }) {
  const content = block.content;
  if (
    typeof content !== "object" ||
    content === null ||
    !Array.isArray((content as { rows?: unknown }).rows)
  ) {
    return null;
  }
  const rows = (content as { rows: unknown[] }).rows;
  return (
    <table>
      <tbody>
        {rows.map((row, ri) => {
          const cells =
            typeof row === "object" &&
            row !== null &&
            Array.isArray((row as { cells?: unknown }).cells)
              ? (row as { cells: unknown[] }).cells
              : [];
          return (
            <tr key={`row-${String(ri)}`}>
              {cells.map((cell, ci) => (
                <td key={`cell-${String(ci)}`}>
                  <TableCellContent cell={cell} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Block rendering ─────────────────────────────────────────────────────

function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <div>
          <p className={alignClass(block)}>
            <InlineContent content={block.content} />
          </p>
          <BlockChildren block={block} />
        </div>
      );

    case "heading": {
      const level =
        typeof block.props.level === "number"
          ? Math.min(Math.max(Math.trunc(block.props.level), 1), 6)
          : 1;
      return (
        <div>
          {createElement(
            `h${level}`,
            { className: alignClass(block) },
            <InlineContent content={block.content} />,
          )}
          <BlockChildren block={block} />
        </div>
      );
    }

    case "quote":
      return (
        <div>
          <blockquote>
            <InlineContent content={block.content} />
          </blockquote>
          <BlockChildren block={block} />
        </div>
      );

    case "codeBlock":
      return (
        <pre className="overflow-x-auto rounded-lg bg-stone-100 p-4 text-sm">
          <code>{inlineToText(block.content)}</code>
        </pre>
      );

    case "table":
      return <TableView block={block} />;

    case "image": {
      const url = stringProp(block, "url");
      if (!url || !isSafeImageSrc(url)) return null;
      return (
        <mdxComponents.Image
          src={url}
          alt={stringProp(block, "name") ?? stringProp(block, "caption")}
          caption={stringProp(block, "caption")}
        />
      );
    }

    // Custom blocks - same component map as MDX, so migrated content
    // renders identically.
    case CUSTOM_BLOCK_TYPES.person: {
      const slug = stringProp(block, "slug");
      if (!slug) return null;
      // Capped to the editor preview's card width: a standalone person
      // block would otherwise stretch to the full content column.
      return (
        <div className="w-full max-w-xs">
          <mdxComponents.Person slug={slug} role={stringProp(block, "role")} />
        </div>
      );
    }

    case CUSTOM_BLOCK_TYPES.personGrid: {
      // Role-preserving entries prop (JSON-stringified [{slug, role?}],
      // same precedent as contentImage's picture prop): compose
      // PersonGrid with Person children exactly as the MDX corpus does.
      // Absent or malformed entries degrade to the legacy slugs CSV.
      const entries = parsePersonGridEntries(stringProp(block, "entries"));
      if (entries !== null) {
        return (
          <mdxComponents.PersonGrid>
            {entries.map((entry, i) => (
              <mdxComponents.Person
                key={`${entry.slug}-${String(i)}`}
                slug={entry.slug}
                role={entry.role}
              />
            ))}
          </mdxComponents.PersonGrid>
        );
      }
      const slugs = stringProp(block, "slugs");
      if (!slugs) return null;
      // Normalise the stored CSV: trim each segment, drop empties - so
      // "alice, bob" and stray commas render correctly.
      const parsed = slugs.split(",").flatMap((s) => {
        const trimmed = s.trim();
        return trimmed ? [trimmed] : [];
      });
      if (parsed.length === 0) return null;
      return <mdxComponents.PersonGrid slugs={parsed} />;
    }

    case CUSTOM_BLOCK_TYPES.gamePreview: {
      const playCricketId = stringProp(block, "playCricketId");
      if (!playCricketId) return null;
      return <mdxComponents.GamePreview playCricketId={playCricketId} />;
    }

    case CUSTOM_BLOCK_TYPES.eventPreview: {
      const id = stringProp(block, "eventId");
      const name = stringProp(block, "name");
      const when = stringProp(block, "when");
      if (!id || !name || !when) return null;
      return <mdxComponents.EventPreview id={id} name={name} when={when} />;
    }

    case CUSTOM_BLOCK_TYPES.contentImage: {
      const src = stringProp(block, "src");
      const alt = stringProp(block, "alt") ?? "";
      const caption = stringProp(block, "caption");
      // props.picture is the JSON-stringified PictureSource descriptor
      // produced by the upload pipeline; with it we render the full
      // responsive ladder, without it we fall back to the plain src.
      const picture = parsePicture(stringProp(block, "picture"));
      if (picture) {
        return (
          <figure className="my-4 max-w-lg self-center">
            <OptimisedImage
              picture={picture}
              alt={alt}
              className="h-auto max-w-full rounded-lg"
              sizes="(max-width: 512px) 100vw, 512px"
            />
            {caption && (
              <figcaption className="mt-2 text-sm text-stone-600">
                {caption}
              </figcaption>
            )}
          </figure>
        );
      }
      if (!src || !isSafeImageSrc(src)) return null;
      return <mdxComponents.Image src={src} alt={alt} caption={caption} />;
    }

    case CUSTOM_BLOCK_TYPES.leagueTable: {
      const divisionId = stringProp(block, "divisionId");
      // Required prop: degrade silently when missing.
      if (!divisionId) return null;
      return (
        <mdxComponents.LeagueTable
          divisionId={divisionId}
          name={stringProp(block, "name")}
        />
      );
    }

    case CUSTOM_BLOCK_TYPES.leaderboard:
      return <mdxComponents.Leaderboard />;

    case CUSTOM_BLOCK_TYPES.recordsWall:
      return <mdxComponents.RecordsWall />;

    case CUSTOM_BLOCK_TYPES.contactForm:
      return (
        <mdxComponents.ContactForm
          title={stringProp(block, "title")}
          description={stringProp(block, "description")}
        />
      );

    case CUSTOM_BLOCK_TYPES.cookieSettingsLink: {
      const text = stringProp(block, "text") ?? "Cookie settings";
      return (
        <mdxComponents.CookieSettingsLink>
          {text}
        </mdxComponents.CookieSettingsLink>
      );
    }

    case CUSTOM_BLOCK_TYPES.consentVersion:
      return <mdxComponents.ConsentVersion />;

    default:
      // Unknown / not-yet-supported block types degrade silently.
      return null;
  }
}

const LIST_TYPES: Record<string, "ul" | "ol" | undefined> = {
  bulletListItem: "ul",
  numberedListItem: "ol",
  checkListItem: "ul",
};

function ListItemView({ item }: { item: ContentBlock }) {
  return (
    <li className={alignClass(item)}>
      {item.type === "checkListItem" && (
        <input
          type="checkbox"
          checked={item.props.checked === true}
          readOnly
          className="mr-2 align-middle"
        />
      )}
      <InlineContent content={item.content} />
      {item.children.length > 0 && <BlocksView blocks={item.children} />}
    </li>
  );
}

/**
 * Group consecutive list-item blocks of the same type into a single list
 * element; render everything else block by block.
 */
function BlocksView({ blocks }: { blocks: ContentBlock[] }) {
  const out: ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) break;

    const listTag = LIST_TYPES[block.type];
    if (!listTag) {
      out.push(
        <Fragment key={block.id}>
          <BlockView block={block} />
        </Fragment>,
      );
      i += 1;
      continue;
    }

    const items: ContentBlock[] = [];
    while (i < blocks.length) {
      const candidate = blocks[i];
      if (candidate?.type !== block.type) break;
      items.push(candidate);
      i += 1;
    }

    out.push(
      createElement(
        listTag,
        {
          key: block.id,
          // Checklists show their checkboxes, not the .mdx-content disc
          // markers a plain ul would get.
          className:
            block.type === "checkListItem" ? "ml-0 list-none" : undefined,
        },
        items.map((item) => <ListItemView key={item.id} item={item} />),
      ),
    );
  }

  return out;
}

// ── Public component ────────────────────────────────────────────────────

/**
 * Single runtime renderer for DB-backed content. Shared by public pages
 * and the admin draft preview. `body` is the raw value from the API; it
 * is structurally validated here, and a document that fails validation
 * renders nothing.
 */
export function ContentBody({
  body,
  className,
}: {
  body: unknown;
  className?: string;
}) {
  const parsed = contentBodySchema.safeParse(body);
  if (!parsed.success) return null;

  return (
    <div className={cn("mdx-content flex flex-col *:mb-4", className)}>
      <BlocksView blocks={parsed.data} />
    </div>
  );
}
