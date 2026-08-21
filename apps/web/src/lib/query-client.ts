import { formatKeyForTelemetry } from "@/lib/authed-query.js";
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
/**
 * Drop every cached query and mutation at an account transition (sign in,
 * sign out, 2FA/recovery completion).
 *
 * `invalidateQueries()` is not enough: it only marks entries stale, so
 * inactive queries keep the previous account's data and active ones keep
 * rendering it while the refetch is in flight. That is the leak in #628 -
 * user B could see (and re-save) user A's fantasy squad.
 *
 * Cancellation comes first on purpose. A fetch issued under the old
 * identity that is still in flight would otherwise resolve after `clear()`
 * and write the old account's response into the fresh cache.
 */
export async function resetAuthCaches(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) =>
        noticeQueryError(err, {
          kind: "query",
          // User-scoped keys carry the account id (#628); the telemetry
          // string drops it while the cache keeps addressing the full key.
          queryKey: formatKeyForTelemetry(query.queryKey),
        }),
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) =>
        noticeQueryError(err, {
          kind: "mutation",
          mutationKey: mutation.options.mutationKey
            ? formatKeyForTelemetry(mutation.options.mutationKey)
            : "unknown",
        }),
    }),
  });
}
