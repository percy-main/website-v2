import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/**
 * Forward any react-query (or react-query-mutation) error to NR
 * Browser. Without this, react-query failures bubble to component-
 * local `error` state and never reach NR — a server 5xx on a query
 * shows as a toast (or nothing) and is invisible to observability.
 */
function noticeQueryError(
  err: unknown,
  attrs: Record<string, string | number | boolean>,
) {
  const error = err instanceof Error ? err : new Error(String(err));
  if (typeof window !== "undefined" && window.newrelic) {
    window.newrelic.noticeError(error, attrs);
  } else {
    console.error("react-query (NR not loaded):", error.message, attrs);
  }
}

/**
 * The app QueryClient, as a factory so main.tsx can create it before
 * first render and seed it from a prerendered document's dehydrated
 * state (prerender/take-over.ts) — the cache must be populated before
 * React mounts or the first commit wipes the prerendered DOM with
 * spinners.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) =>
        noticeQueryError(err, {
          kind: "query",
          queryKey: query.queryKey
            .flatMap((part) => (typeof part === "string" ? [part] : []))
            .join(":"),
        }),
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) =>
        noticeQueryError(err, {
          kind: "mutation",
          mutationKey:
            mutation.options.mutationKey
              ?.flatMap((part) => (typeof part === "string" ? [part] : []))
              .join(":") ?? "unknown",
        }),
    }),
  });
}
