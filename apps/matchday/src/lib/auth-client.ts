import { passkeyClient } from "@better-auth/passkey/client";
import { ac, roles } from "@percy-main/shared/auth/permissions";
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
 * Names of every runtime cache populated by vite-plugin-pwa for
 * /api/* responses. Kept in lockstep with vite.config.ts. Used to
 * wipe per-user data on sign-out / sign-in-as-someone-else so a
 * shared device doesn't leak account A's availability/charges/team-
 * sheet to account B (each Workbox StaleWhileRevalidate entry is
 * keyed on URL only, so without this clear the first paint after
 * switching shows the previous user's cached body).
 */
const PER_USER_RUNTIME_CACHES = [
  "matchday-availability-active",
  "matchday-team-sheet",
  "matchday-charges",
  "matchday-games",
];

async function clearPerUserCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(
    PER_USER_RUNTIME_CACHES.map((name) =>
      caches.delete(name).catch(() => false),
    ),
  );
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
  }
}

const LAST_USER_KEY = "matchday-last-user-id";

/**
 * Detect a sign-in-as-different-user (e.g. shared family device) and
 * wipe stale per-user caches before any cached response is served. Call
 * from app boot once the session resolves.
 */
export async function ensureCachesMatchUser(
  userId: string | null | undefined,
): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const previous = localStorage.getItem(LAST_USER_KEY);
  const current = userId ?? null;
  if (current !== previous) {
    await clearPerUserCaches();
    if (current) {
      localStorage.setItem(LAST_USER_KEY, current);
    } else {
      localStorage.removeItem(LAST_USER_KEY);
    }
  }
}
