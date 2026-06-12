import {
  contentPathSchema,
  contentSlugSchema,
} from "@percy-main/shared/content";

// Page hierarchy derivation for the pages migration (#496): the static
// corpus' directory layout IS the page tree. dir/_index.mdx is the
// parent item for the directory (slug = dir name); every sibling file
// is a child of that item. The derived URL paths must match the web
// app's static routing (filePathToUrlPath in apps/web/src/lib/content.ts)
// exactly, or migrated pages would come up at different URLs than their
// static ancestors.

export interface PageNode {
  /** Path relative to content/pages, posix separators. */
  file: string;
  slug: string;
  /** Materialised URL path, e.g. "/cricket/ground/grounds-team". */
  path: string;
  /** Parent page's URL path, or null for a root page. */
  parentPath: string | null;
}

export interface PageTreeFailure {
  file: string;
  /** Derived URL path when derivable (used to fail descendants too). */
  path?: string;
  reason: string;
}

export interface PageTree {
  /** Valid nodes, path-ordered: every ancestor precedes its descendants. */
  ordered: PageNode[];
  failed: PageTreeFailure[];
}

/**
 * Byte-for-byte mirror of the web app's transform (apps/web
 * src/lib/content.ts) minus the Vite glob prefix: ".mdx" stripped,
 * "_index" representing its directory. The migration derives paths
 * structurally (parent path + slug); this is the independent
 * cross-check.
 */
export function filePathToUrlPath(relPath: string): string {
  let path = relPath.replace(/\.mdx$/, "");
  path = path.replace(/\/_index$/, "").replace(/^_index$/, "");
  return "/" + path;
}

function deriveNode(file: string): PageNode {
  const segments = file.split("/");
  const basename = segments.pop();
  if (basename === undefined || !basename.endsWith(".mdx")) {
    throw new Error("not an .mdx file");
  }
  const dirSegments = segments;

  let slug: string;
  let pathSegments: string[];
  if (basename === "_index.mdx") {
    const dirName = dirSegments[dirSegments.length - 1];
    if (dirName === undefined) {
      throw new Error("root _index.mdx has no slug (its path would be '/')");
    }
    slug = dirName;
    pathSegments = dirSegments;
  } else {
    slug = basename.replace(/\.mdx$/, "");
    pathSegments = [...dirSegments, slug];
  }

  if (!contentSlugSchema.safeParse(slug).success) {
    throw new Error(
      `slug '${slug}' is not a valid content slug (lowercase letters, numbers and hyphens)`,
    );
  }
  const path = "/" + pathSegments.join("/");
  if (!contentPathSchema.safeParse(path).success) {
    throw new Error(`derived path '${path}' is not a valid page path`);
  }

  const parentPath =
    pathSegments.length > 1 ? "/" + pathSegments.slice(0, -1).join("/") : null;

  // Sanity check: the structural derivation (parent path + slug) must
  // agree with the web app's file-path transform, segment for segment.
  const expected = filePathToUrlPath(file);
  if (path !== expected) {
    throw new Error(
      `derived path '${path}' does not match filePathToUrlPath '${expected}'`,
    );
  }
  if (path !== (parentPath ?? "") + "/" + slug) {
    throw new Error(`derived path '${path}' is not parent path + '/' + slug`);
  }

  return { file, slug, path, parentPath };
}

/**
 * Build the page tree from the corpus file list. Structural failures
 * (bad slug, missing parent _index.mdx, root _index.mdx) fail the file
 * AND - because a page cannot be inserted without its parent row - every
 * descendant of a failed file fails too.
 */
export function buildPageTree(files: string[]): PageTree {
  const failed: PageTreeFailure[] = [];

  const candidates: PageNode[] = [];
  for (const file of [...files].sort()) {
    try {
      candidates.push(deriveNode(file));
    } catch (err) {
      failed.push({
        file,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Path order: "/a" sorts before "/a/b", so every ancestor is processed
  // (and inserted) before its descendants - the same ordering the admin
  // page tree relies on.
  candidates.sort((a, b) => a.path.localeCompare(b.path));

  const okPaths = new Set<string>();
  const failedPaths = new Set<string>();
  const ordered: PageNode[] = [];
  for (const node of candidates) {
    if (node.parentPath !== null && !okPaths.has(node.parentPath)) {
      const reason = failedPaths.has(node.parentPath)
        ? `parent failed (${node.parentPath})`
        : `parent page required: no _index.mdx provides '${node.parentPath}'`;
      failed.push({ file: node.file, path: node.path, reason });
      failedPaths.add(node.path);
      continue;
    }
    okPaths.add(node.path);
    ordered.push(node);
  }

  return { ordered, failed };
}

/**
 * Runtime counterpart of buildPageTree's structural propagation: once a
 * page fails conversion or upsert, every page under it must fail too
 * (its row will not exist to parent them). Processing is path-ordered,
 * so checking the direct parent propagates transitively as each failed
 * child joins the set.
 */
export function parentFailureReason(
  node: PageNode,
  failedPaths: ReadonlySet<string>,
): string | null {
  if (node.parentPath !== null && failedPaths.has(node.parentPath)) {
    return `parent failed (${node.parentPath})`;
  }
  return null;
}
