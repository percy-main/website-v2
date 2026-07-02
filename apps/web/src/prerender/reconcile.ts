// Pure diff logic for the prerender reconcile loop: given the API's
// manifest of live content and the state file from the last successful
// sync, decide what to (re)render and what to tear down. The Lambda
// (server/prerender/lambda.ts) runs this on every publish trigger and on
// the 15-minute schedule - one code path covers publishes, unpublishes,
// edits, scheduled go-lives, missed triggers and drift.

export interface ManifestItem {
  url: string;
  kind: "page" | "news" | "event" | "person";
  slug: string;
  updatedAt: string;
  publishedAt: string;
}

export interface NavItem {
  path: string;
  title: string;
  menuOrder: number;
  isMainMenu: boolean;
}

interface StateEntry {
  updatedAt: string;
  publishedAt: string;
}

/**
 * `_prerender/state.json`: what the last sync rendered, plus the hash of
 * the nav it embedded in every document. Rendered bundle version is NOT
 * tracked here - deploys always force a full render-all because every
 * document's asset references change.
 */
export interface PrerenderState {
  v: 1;
  navHash: string;
  items: Record<string, StateEntry>;
}

export interface ReconcilePlan {
  /** Why everything is being re-rendered, when it is. */
  mode: "initial" | "nav-changed" | "forced" | "diff";
  toRender: ManifestItem[];
  /** URLs rendered previously that are no longer live. */
  toUnrender: string[];
}

/**
 * Stable content hash of the nav items every snapshot embeds (djb2 -
 * cheap and deterministic; collision risk is irrelevant, a false match
 * self-heals on the next full render). Any change to the published page
 * set - title, path, menu placement - changes the header/sidebars baked
 * into EVERY document, so a nav change escalates to a full re-render.
 */
export function navHash(items: NavItem[]): string {
  const canonical = JSON.stringify(
    items
      .map(({ path, title, menuOrder, isMainMenu }) => ({
        path,
        title,
        menuOrder,
        isMainMenu,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export function planReconcile(options: {
  manifest: ManifestItem[];
  state: PrerenderState | null;
  currentNavHash: string;
  force?: boolean;
}): ReconcilePlan {
  const { manifest, state, currentNavHash, force = false } = options;

  const liveUrls = new Set(manifest.map((item) => item.url));
  const toUnrender = Object.keys(state?.items ?? {}).filter(
    (url) => !liveUrls.has(url),
  );

  if (force) return { mode: "forced", toRender: manifest, toUnrender };
  if (state === null) return { mode: "initial", toRender: manifest, toUnrender };
  if (state.navHash !== currentNavHash) {
    return { mode: "nav-changed", toRender: manifest, toUnrender };
  }

  const toRender = manifest.filter((item) => {
    const previous = state.items[item.url];
    return (
      previous?.updatedAt !== item.updatedAt ||
      previous.publishedAt !== item.publishedAt
    );
  });
  return { mode: "diff", toRender, toUnrender };
}

/** The state file a completed sync should persist. */
export function nextState(
  manifest: ManifestItem[],
  currentNavHash: string,
  /** URLs that failed to render this sync - left out so the next reconcile retries them. */
  failedUrls: ReadonlySet<string> = new Set(),
): PrerenderState {
  const items: Record<string, StateEntry> = {};
  for (const item of manifest) {
    if (failedUrls.has(item.url)) continue;
    items[item.url] = {
      updatedAt: item.updatedAt,
      publishedAt: item.publishedAt,
    };
  }
  return { v: 1, navHash: currentNavHash, items };
}
