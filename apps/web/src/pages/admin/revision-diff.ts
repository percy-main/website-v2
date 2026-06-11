import { CUSTOM_BLOCK_TYPES } from "@percy-main/shared/content";

// Plain-text projection + line diff for the revision history UI (#500).
// Per the issue, a text diff of body + metadata is sufficient - no
// rendered visual diff - so blocks project to one line each (type-aware
// prefix + inline text) and the diff is a classic line LCS. Everything
// here is pure so it unit-tests without a DOM.

export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((node: unknown) => {
      if (typeof node !== "object" || node === null) return "";
      const candidate = node as {
        type?: unknown;
        text?: unknown;
        content?: unknown;
      };
      if (typeof candidate.text === "string") return candidate.text;
      if (candidate.type === "link") return inlineText(candidate.content);
      return "";
    })
    .join("");
}

/** Table content is structured (rows of cells), not an inline array. */
function tableText(content: unknown): string[] {
  const rows = (content as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return ["[Table]"];
  return rows.map((row: unknown) => {
    const cells = (row as { cells?: unknown } | null)?.cells;
    if (!Array.isArray(cells)) return "|";
    const texts = cells.map((cell: unknown) => {
      // Cells are inline arrays in older documents, or objects with a
      // content array in newer ones.
      if (Array.isArray(cell)) return inlineText(cell);
      return inlineText((cell as { content?: unknown } | null)?.content);
    });
    return `| ${texts.join(" | ")} |`;
  });
}

function stringProp(props: Record<string, unknown>, name: string): string {
  const value = props[name];
  return typeof value === "string" ? value : "";
}

/**
 * One human-readable line (or a few, for tables) per block. Custom
 * blocks render as bracketed labels - enough for an editor to see that
 * "the photo moved" without a visual diff.
 */
function blockLines(block: unknown, depth: number): string[] {
  if (typeof block !== "object" || block === null) return [];
  const candidate = block as {
    type?: unknown;
    props?: unknown;
    content?: unknown;
    children?: unknown;
  };
  const type = typeof candidate.type === "string" ? candidate.type : "";
  const props =
    typeof candidate.props === "object" && candidate.props !== null
      ? (candidate.props as Record<string, unknown>)
      : {};
  const indent = "  ".repeat(depth);
  const text = inlineText(candidate.content);

  const lines: string[] = [];
  switch (type) {
    case "heading": {
      const level = typeof props.level === "number" ? props.level : 1;
      lines.push(`${indent}${"#".repeat(level)} ${text}`);
      break;
    }
    case "bulletListItem":
      lines.push(`${indent}- ${text}`);
      break;
    case "numberedListItem":
      lines.push(`${indent}1. ${text}`);
      break;
    case "checkListItem":
      lines.push(`${indent}[${props.checked === true ? "x" : " "}] ${text}`);
      break;
    case "quote":
      lines.push(`${indent}> ${text}`);
      break;
    case "codeBlock":
      for (const codeLine of text.split("\n")) {
        lines.push(`${indent}    ${codeLine}`);
      }
      break;
    case "table":
      for (const rowLine of tableText(candidate.content)) {
        lines.push(`${indent}${rowLine}`);
      }
      break;
    // Custom block labels must cover EVERY render-relevant prop: a prop
    // change the projection drops would diff as "No differences" while
    // restore still changes the live page.
    case CUSTOM_BLOCK_TYPES.person: {
      const role = stringProp(props, "role");
      lines.push(
        `${indent}[Person card: ${stringProp(props, "slug")}${role ? ` (${role})` : ""}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.personGrid: {
      // entries is the canonical role-preserving prop (compact JSON);
      // legacy blocks only have the slugs CSV.
      const entries = stringProp(props, "entries");
      lines.push(
        `${indent}[Person grid: ${entries || stringProp(props, "slugs")}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.contentImage: {
      const alt = stringProp(props, "alt");
      const caption = stringProp(props, "caption");
      // src identifies the uploaded image (it is the descriptor's
      // fallback URL), so a replaced photo always shows in the diff.
      const src = stringProp(props, "src");
      lines.push(
        `${indent}[Photo${alt ? `: ${alt}` : ""}${caption ? ` - ${caption}` : ""}${src ? ` (${src})` : ""}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.gamePreview:
      lines.push(
        `${indent}[Game preview: ${stringProp(props, "playCricketId")}]`,
      );
      break;
    case CUSTOM_BLOCK_TYPES.eventPreview:
      lines.push(
        `${indent}[Event preview: ${stringProp(props, "name")} (${stringProp(props, "eventId")}, ${stringProp(props, "when")})]`,
      );
      break;
    case CUSTOM_BLOCK_TYPES.leagueTable: {
      const name = stringProp(props, "name");
      lines.push(
        `${indent}[League table: ${stringProp(props, "divisionId")}${name ? ` - ${name}` : ""}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.leaderboard:
      lines.push(`${indent}[Leaderboard]`);
      break;
    case CUSTOM_BLOCK_TYPES.recordsWall:
      lines.push(`${indent}[Records wall]`);
      break;
    case CUSTOM_BLOCK_TYPES.contactForm: {
      const title = stringProp(props, "title");
      const description = stringProp(props, "description");
      lines.push(
        `${indent}[Contact form${title ? `: ${title}` : ""}${description ? ` - ${description}` : ""}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.cookieSettingsLink: {
      const linkText = stringProp(props, "text");
      lines.push(
        `${indent}[Cookie settings link${linkText ? `: ${linkText}` : ""}]`,
      );
      break;
    }
    case CUSTOM_BLOCK_TYPES.consentVersion:
      lines.push(`${indent}[Consent version]`);
      break;
    default:
      // Paragraphs and anything unrecognised: plain text. Blank
      // paragraphs are kept so spacing changes still show.
      lines.push(`${indent}${text}`);
      break;
  }
  if (Array.isArray(candidate.children)) {
    for (const child of candidate.children) {
      lines.push(...blockLines(child, depth + 1));
    }
  }
  return lines;
}

/** Project a stored body (block array) onto comparable text lines. */
export function blocksToLines(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((block: unknown) => blockLines(block, 0));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Item details (title/description/metadata) as comparable lines. Keys
 * are sorted so JSONB key-order churn never reads as a change.
 */
export function detailLines(item: {
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
}): string[] {
  return [
    `Title: ${item.title}`,
    `Description: ${item.description ?? ""}`,
    ...JSON.stringify(sortKeysDeep(item.metadata), null, 2).split("\n"),
  ];
}

/**
 * Line diff via longest common subsequence - the bodies are club pages,
 * tens of lines, so the quadratic table is fine.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // lcs(i, j) = LCS length of before.slice(i) vs after.slice(j), stored
  // flat to keep index access checked-friendly.
  const width = m + 1;
  const table = new Array<number>((n + 1) * width).fill(0);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? lcs(i + 1, j + 1) + 1
          : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const a = before[i];
    const b = after[j];
    if (a === undefined || b === undefined) break;
    if (a === b) {
      out.push({ type: "same", text: a });
      i += 1;
      j += 1;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      out.push({ type: "removed", text: a });
      i += 1;
    } else {
      out.push({ type: "added", text: b });
      j += 1;
    }
  }
  for (; i < n; i++) {
    const a = before[i];
    if (a !== undefined) out.push({ type: "removed", text: a });
  }
  for (; j < m; j++) {
    const b = after[j];
    if (b !== undefined) out.push({ type: "added", text: b });
  }
  return out;
}
