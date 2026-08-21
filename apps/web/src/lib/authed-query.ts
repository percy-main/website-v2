import { useSession } from "@/lib/auth-client.js";
import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

/**
 * User-scoped query caching (#628).
 *
 * Two accounts share one page-lifetime QueryClient, so any key that
 * addresses "the signed-in user's data" has to carry the user's identity.
 * Without it, `["fantasy", "my-team"]` means user A's squad before a logout
 * and user B's squad after, and react-query cannot tell the difference:
 * B renders A's cached squad and can save it as their own.
 *
 * `resetAuthCaches` (lib/query-client.ts) wipes the cache at each account
 * transition, and this module is the second line of defence: even if a new
 * login path forgets to reset, a key built here can never resolve to
 * another account's entry.
 *
 * PUBLIC content stays unprefixed. `["content", ...]`, `["games", ...]` and
 * friends are seeded from the prerendered document's dehydrated state
 * (ADR 052), which is generated with no session at all - prefixing those
 * keys would orphan the seed and reintroduce the hydration flash.
 */

/**
 * Namespace fronting every user-scoped key. Makes the convention greppable
 * and keeps prefixed keys from colliding with a public key that happens to
 * start with a user id.
 */
export const AUTHED_KEY_NAMESPACE = "user-scoped";

/**
 * Stand-in identity for a user-scoped query rendered without a resolved
 * session. Everything behind `RequireAuth` has a session before it mounts,
 * but a public page can hold a user-scoped query gated on `enabled`
 * (`["availability", "active"]` on the public availability page). Keying
 * those under a reserved id keeps signed-out reads in their own bucket
 * rather than sharing a slot with the next account to sign in.
 */
export const ANONYMOUS_USER_KEY = "anonymous";

/** Stands in for the account id when a key is rendered for observability. */
export const REDACTED_USER_KEY = "<user>";

/**
 * Prefix a user-scoped key with the owning account. Exported so that
 * invalidation call sites build the key exactly the way `useAuthedQuery`
 * does - if the two ever drift, invalidation silently stops matching.
 */
export function authedQueryKey(
  userId: string,
  queryKey: readonly unknown[],
): QueryKey {
  return [AUTHED_KEY_NAMESPACE, userId, ...queryKey];
}

/**
 * Render a query key as a telemetry string with the account id removed.
 *
 * Cache identity keeps the full key; only what leaves the browser is
 * redacted, so a New Relic error attribute (or the console fallback)
 * never carries a user id.
 */
export function formatKeyForTelemetry(queryKey: readonly unknown[]): string {
  const parts =
    queryKey[0] === AUTHED_KEY_NAMESPACE
      ? [AUTHED_KEY_NAMESPACE, REDACTED_USER_KEY, ...queryKey.slice(2)]
      : queryKey;
  return parts
    .flatMap((part) => (typeof part === "string" ? [part] : []))
    .join(":");
}

/** The signed-in user's id, or `ANONYMOUS_USER_KEY` when there is no session. */
export function useAuthedUserId(): string {
  const { data } = useSession();
  return data?.user.id ?? ANONYMOUS_USER_KEY;
}

/**
 * Builds user-scoped keys for the current session. Use at every call site
 * that invalidates (or otherwise addresses) a key owned by
 * `useAuthedQuery`:
 *
 * ```ts
 * const authedKey = useAuthedQueryKey();
 * void queryClient.invalidateQueries({ queryKey: authedKey(["fantasy"]) });
 * ```
 */
export function useAuthedQueryKey(): (
  queryKey: readonly unknown[],
) => QueryKey {
  const userId = useAuthedUserId();
  return (queryKey: readonly unknown[]) => authedQueryKey(userId, queryKey);
}

/**
 * `useQuery` for data owned by the signed-in account. Pass the logical key
 * (`["fantasy", "my-team"]`); the hook prefixes it with the session user id
 * before handing it to react-query.
 */
export function useAuthedQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
>(
  options: Omit<UseQueryOptions<TQueryFnData, TError, TData>, "queryKey"> & {
    queryKey: readonly unknown[];
  },
): UseQueryResult<TData, TError> {
  const userId = useAuthedUserId();
  return useQuery<TQueryFnData, TError, TData>({
    ...options,
    queryKey: authedQueryKey(userId, options.queryKey),
  });
}
