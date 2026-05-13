import { PageLoading } from "@/components/primitives/page-loading.js";
import { useSession } from "@/lib/auth-client.js";
import { signInUrl } from "@/lib/main-site.js";
import { useEffect } from "react";
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
 */
export function RequireAuth() {
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending || session) return;
    window.location.href = signInUrl();
  }, [isPending, session]);

  if (isPending || !session) {
    return <PageLoading />;
  }

  return <Outlet />;
}
