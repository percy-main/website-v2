import type { DehydratedState } from "@tanstack/react-query";
import { matchRoutes, type RouteObject } from "react-router";

/**
 * Payload the prerenderer embeds in each cached document
 * (assemble-document.ts). Versioned so a stale snapshot rendered by an
 * older bundle degrades to a plain CSR boot instead of hydrating a shape
 * the current code no longer understands.
 */
export interface PrerenderPayload {
  v: 1;
  dehydratedState: DehydratedState;
}

declare global {
  interface Window {
    __PM_PRERENDER__?: unknown;
  }
}

/** The embedded prerender payload, or null on a plain CSR document. */
export function readPrerenderPayload(): PrerenderPayload | null {
  const raw = window.__PM_PRERENDER__;
  if (typeof raw !== "object" || raw === null) return null;
  const payload = raw as Partial<PrerenderPayload>;
  if (payload.v !== 1) return null;
  if (typeof payload.dehydratedState !== "object") return null;
  return payload as PrerenderPayload;
}

/**
 * Resolve the lazy modules for every route matching the current URL and
 * graft them onto the route objects, so the first router render commits
 * synchronously. Without this the initial commit renders the router's
 * fallback (nothing), wiping a prerendered document's DOM and flashing
 * blank before the module loads.
 */
export async function preloadMatchedRoutes(
  routes: RouteObject[],
  pathname: string,
): Promise<void> {
  const matches = matchRoutes(routes, pathname) ?? [];
  await Promise.all(
    matches.map(async ({ route }) => {
      if (typeof route.lazy !== "function") return;
      const mod = await route.lazy();
      Object.assign(route, mod, { lazy: undefined });
    }),
  );
}
