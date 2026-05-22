import { lazy, type ComponentType } from "react";

const RELOADED_KEY = "matchday:chunk-reload-attempted";

// A chunk-load error from Vite's dynamic import has no stable error
// class - the spec wording varies by browser. We sniff the message
// instead (covers Chrome / Safari / Firefox).
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.name}: ${error.message}`.toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("loading css chunk")
  );
}

/**
 * `lazy()` with a one-shot hard reload on chunk-load failure.
 *
 * When a new build deploys, the running shell still references the
 * previous build's chunk filenames. If the user navigates to a route
 * whose chunk has been purged, the dynamic import 404s. The service
 * worker prompt-to-reload pattern is meant to prevent this, but it's
 * not bulletproof (fresh tabs, SW unregistered, deploy mid-session,
 * etc.) — so on the first chunk failure we reload once to pick up the
 * new shell. If that *still* fails, we let the error propagate to the
 * route-level error boundary so the user gets a clear message instead
 * of a reload loop.
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      const mod = await factory();
      // A lazy import succeeded, so we're definitively on a build whose
      // chunks resolve. Reset the guard so the *next* deploy gets a
      // fresh one-shot retry rather than skipping straight to the
      // error boundary. Clearing on entrypoint mount would break this:
      // a post-reload failure would re-set the flag, then reload, then
      // clear again, and loop forever.
      sessionStorage.removeItem(RELOADED_KEY);
      return mod;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      const alreadyReloaded = sessionStorage.getItem(RELOADED_KEY) === "1";
      if (alreadyReloaded) throw error;
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
      // Return a never-resolving promise so React doesn't try to
      // render anything in the split-second before reload kicks in.
      return await new Promise<{ default: T }>(() => undefined);
    }
  });
}
