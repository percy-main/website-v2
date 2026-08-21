/**
 * Names of every runtime cache populated by vite-plugin-pwa for
 * /api/* responses. Kept in lockstep with vite.config.ts. Used to
 * wipe per-user data on sign-out / sign-in-as-someone-else so a
 * shared device doesn't leak account A's availability/charges/team-
 * sheet to account B (each Workbox StaleWhileRevalidate entry is
 * keyed on URL only, so without this clear the first paint after
 * switching shows the previous user's cached body).
 *
 * Also consumed by `api-client.ts` to evict a single entry when a
 * /api/* GET returns 401 - covers the case where a cookie expired
 * server-side without the user clicking sign-out.
 *
 * Lives in its own module rather than in `auth-client.ts` so that
 * `api-client.ts` can read it without importing the auth client:
 * `auth-client.ts` now depends on `push.ts`, which depends on
 * `api-client.ts`, and routing that through `auth-client.ts` would
 * close an import cycle.
 */
export const PER_USER_RUNTIME_CACHES = [
  "matchday-availability-active",
  "matchday-team-sheet",
  "matchday-charges",
  "matchday-games",
];

/**
 * Wipe every per-user runtime cache. Returns `true` only if every
 * `caches.delete()` resolved cleanly - Safari private mode can have
 * the `caches` API present but reject deletes, in which case we must
 * NOT report the user's caches as clean (the previous-user data is
 * still on disk).
 */
export async function clearPerUserCaches(): Promise<boolean> {
  if (typeof caches === "undefined") return true;
  const results = await Promise.all(
    PER_USER_RUNTIME_CACHES.map((name) =>
      caches
        .delete(name)
        .then(() => true)
        .catch(() => false),
    ),
  );
  return results.every(Boolean);
}
