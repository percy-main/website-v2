import { PageLoading } from "@/components/primitives/page-loading.js";
import { ensureCachesMatchUser, useSession } from "@/lib/auth-client.js";
import { signInUrl } from "@/lib/main-site.js";
import { useEffect, useState } from "react";
import { Outlet } from "react-router";

/**
 * Guards the matchday app against unauthenticated access.
 *
 * Auth lives on the main site (`percymain.org/auth/login`). If no session
 * is present we redirect there with `?returnTo=<current matchday URL>`;
 * the main site validates that the redirect points back to a
 * `.percymain.org` host and `window.location.href`'s us back here.
 *
 * Critical: this MUST be `window.location.href = ...`, not a router
 * navigate — we're crossing a subdomain boundary so a full page navigation
 * is the only way to get there.
 *
 * Also acts as the **render gate** for per-user Workbox cache hygiene.
 * The four StaleWhileRevalidate caches (availability, charges, public
 * team sheet, games) are keyed on URL only, so on a shared device the
 * first paint after switching accounts would otherwise serve user A's
 * cached body to user B before the network revalidate returned. We
 * resolve `ensureCachesMatchUser(session.user.id)` BEFORE rendering
 * `<Outlet />` so no child route can start a fetch until any stale
 * cache from the previous user has been deleted. Doing it in AppShell
 * via useEffect raced with child useQuery hooks in the same commit.
 */
export function RequireAuth() {
  const { data: session, isPending } = useSession();
  const userId = session?.user.id ?? null;

  // Tracks the user id we've successfully cleared caches for. null until
  // the first ensureCachesMatchUser() call resolves; mismatch with the
  // resolved session id (e.g. account swap) re-suspends the gate.
  const [cachesReadyForUser, setCachesReadyForUser] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (isPending || !session) return;
    let cancelled = false;
    void ensureCachesMatchUser(userId).then(() => {
      if (!cancelled) setCachesReadyForUser(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [isPending, session, userId]);

  useEffect(() => {
    if (isPending || session) return;
    window.location.href = signInUrl();
  }, [isPending, session]);

  if (isPending || !session) {
    return <PageLoading />;
  }

  // Gate the child routes until the cache wipe has resolved for the
  // currently-signed-in user. Tiny window in practice (caches.delete
  // is fast even on cold cache) but eliminates the race where a child
  // useQuery hook fires before stale data is gone.
  if (cachesReadyForUser !== userId) {
    return <PageLoading />;
  }

  return <Outlet />;
}
