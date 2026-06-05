import { passkeyClient } from "@better-auth/passkey/client";
import {
  ac,
  checkPermission,
  roles,
} from "@percy-main/shared/auth/permissions";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
// VITE_API_URL is e.g. "https://api.v2.percymain.org/api" — strip the /api
// suffix since better-auth appends its own basePath (/api/auth).
const baseURL = apiUrl.replace(/\/api$/, "");

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    // Cross-subdomain cookies are scoped to .percymain.org by the API.
    // Sending credentials is what makes the cookie attach to API calls
    // from matchday.percymain.org → api.v2.percymain.org.
    credentials: "include",
  },
  plugins: [passkeyClient(), twoFactorClient(), adminClient({ ac, roles })],
});

export const { useSession } = authClient;

/**
 * `useSession().data.user` shape with the `role` field that
 * better-auth's admin plugin attaches at runtime but doesn't surface in
 * the generated client types. Use this instead of inline
 * `as { role?: string | null }` casts at every read site.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
}

/**
 * True iff the user has the `matchday:view` permission — i.e. access to
 * the officials-only surfaces (extra Availability tab,
 * /api/matchday/past-unfinished, etc.). Mirrors the server-side
 * `requirePermission("matchday", "view")` preHandler so client-side
 * gates (`enabled:` on queries, tab visibility) and server-side
 * authorization use the same source of truth.
 */
export function canViewMatchdayAdmin(
  user: { role?: string | null } | null | undefined,
): boolean {
  return checkPermission(user?.role ?? null, "matchday", "view");
}

/**
 * True iff the user has the `matchday:manage` permission — i.e. can
 * mutate matchdays (create one via Pick team, manage the squad, wrap up
 * the result, cancel). Mirrors the server-side
 * `requirePermission("matchday", "manage")` preHandler (`adminRole` in
 * the matchday routes), so action affordances are gated on exactly the
 * permission the API enforces — never the broader `view` permission,
 * which a `matchday_viewer` holds without `manage` and would 403 on.
 */
export function canManageMatchday(
  user: { role?: string | null } | null | undefined,
): boolean {
  return checkPermission(user?.role ?? null, "matchday", "manage");
}

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
 * /api/* GET returns 401 — covers the case where a cookie expired
 * server-side without the user clicking sign-out.
 */
export const PER_USER_RUNTIME_CACHES = [
  "matchday-availability-active",
  "matchday-team-sheet",
  "matchday-charges",
  "matchday-games",
];

/**
 * Wipe every per-user runtime cache. Returns `true` only if every
 * `caches.delete()` resolved cleanly — Safari private mode can have
 * the `caches` API present but reject deletes, in which case we must
 * NOT report the user's caches as clean (the previous-user data is
 * still on disk).
 */
async function clearPerUserCaches(): Promise<boolean> {
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

/**
 * Sign out + clear any cached per-user API responses. Use this instead
 * of `authClient.signOut()` everywhere a sign-out is wired up.
 */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    await clearPerUserCaches();
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LAST_USER_KEY);
    }
  }
}

const LAST_USER_KEY = "matchday-last-user-id";

/**
 * Detect a sign-in-as-different-user (e.g. shared family device) and
 * wipe stale per-user caches before any cached response is served. Call
 * from app boot once the session resolves.
 *
 * Returns `true` only if the caches are guaranteed in-sync with the
 * resolved user — the render gate in <RequireAuth /> relies on this to
 * decide whether to allow child routes to mount or force a reload.
 *
 * Note on the localStorage trust model: the key is an optimisation so
 * a returning user keeps the SWR benefit on cold start. A pre-poisoned
 * key (attacker pre-sets it to a victim's user id on a shared device)
 * would skip the wipe — but the cache-eviction-on-401 hook in
 * `api-client.ts` covers that residual leak path: any stale cached
 * response that survives a session expiry returns 401 on revalidate
 * and is dropped from the cache before the next paint.
 */
export async function ensureCachesMatchUser(
  userId: string | null | undefined,
): Promise<boolean> {
  if (typeof localStorage === "undefined") return true;
  const previous = localStorage.getItem(LAST_USER_KEY);
  const current = userId ?? null;
  if (current !== previous) {
    const cleared = await clearPerUserCaches();
    if (!cleared) return false;
    if (current) {
      localStorage.setItem(LAST_USER_KEY, current);
    } else {
      localStorage.removeItem(LAST_USER_KEY);
    }
  }
  return true;
}
