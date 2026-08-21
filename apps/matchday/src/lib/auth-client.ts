import { passkeyClient } from "@better-auth/passkey/client";
import {
  ac,
  checkPermission,
  roles,
} from "@percy-main/shared/auth/permissions";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import {
  disablePushOnThisDevice,
  reconcilePushSubscriptionForUser,
} from "./push.js";
import { clearPerUserCaches } from "./runtime-caches.js";

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
 * Ceiling on the push teardown during sign-out. `navigator.serviceWorker
 * .ready` never settles when no registration ever activates (dev builds,
 * a browser with the SW disabled), and a sign-out button that hangs
 * forever is worse than a subscription that survives one extra boot -
 * the next signed-in boot reconciles it either way.
 */
const PUSH_TEARDOWN_TIMEOUT_MS = 3_000;

function withTimeout(work: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    work,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Sign out + drop this device's push subscription + clear any cached
 * per-user API responses. Use this instead of `authClient.signOut()`
 * everywhere a sign-out is wired up.
 */
export async function signOut(): Promise<void> {
  // Order matters: the DELETE /api/me/push-subscriptions inside
  // `disablePushOnThisDevice` has to authenticate as the departing user,
  // so it must run while the session cookie is still valid. It also
  // unsubscribes locally and clears the stashed SW push config, which is
  // what stops `pushsubscriptionchange` re-registering the endpoint for
  // whoever signs in next on a shared device.
  //
  // Best-effort throughout: sign-out must complete even if push teardown
  // throws or stalls. A subscription that outlives this call is caught
  // by `reconcilePushSubscriptionForUser` on the next signed-in boot.
  try {
    await withTimeout(disablePushOnThisDevice(), PUSH_TEARDOWN_TIMEOUT_MS);
  } catch {
    // ignore
  }

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
    // Whoever is signed in now is not who this device was last used by,
    // so the browser's push subscription may still belong to the
    // previous account. Reconcile it against the server (drop it unless
    // it is registered to the current user) - deliberately not awaited,
    // because the render gate below must not block on a network call
    // that the PWA routinely makes offline.
    void reconcilePushSubscriptionForUser(current);

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
