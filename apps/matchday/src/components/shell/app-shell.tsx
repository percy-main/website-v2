import {
  BottomTabBar,
  tabsForRole,
} from "@/components/shell/bottom-tab-bar.js";
import { DesktopSideNav } from "@/components/shell/desktop-side-nav.js";
import { OfflineIndicator } from "@/components/shell/offline-indicator.js";
import { ServiceWorkerUpdate } from "@/components/shell/sw-update.js";
import { TopBar } from "@/components/shell/top-bar.js";
import { ensureCachesMatchUser, useSession } from "@/lib/auth-client.js";
import { useEffect } from "react";
import { Outlet } from "react-router";

/**
 * Top-level shell wrapping every authenticated route. Renders the top
 * header on mobile + the side nav on desktop, with the route content
 * in between, the bottom tab bar pinned, and the offline + SW update
 * banners as overlays.
 */
export function AppShell() {
  const { data: session } = useSession();
  // Shared-device defence: if the resolved session belongs to a
  // different user than the last cached-data user, wipe the per-user
  // SW caches before any cached response can leak across accounts.
  useEffect(() => {
    void ensureCachesMatchUser(session?.user.id);
  }, [session?.user.id]);
  // Coarse role detection. better-auth's admin plugin stores role on the
  // user. Anyone with `official` (or any admin-ish role that's also a
  // team official) sees the extra Squad + Availability tabs. Pure
  // members see the player view. Admin-only matchday admin surfaces
  // stay on the main site, so we don't branch on them here.
  const role: "player" | "official" = (() => {
    const r =
      (session?.user as { role?: string | null } | undefined)?.role ?? "";
    if (r === "official" || r.includes("admin")) return "official";
    return "player";
  })();
  const tabs = tabsForRole(role);
  return (
    <div className="bg-surface-raised text-text flex min-h-dvh">
      <DesktopSideNav tabs={tabs} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineIndicator />
        <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomTabBar tabs={tabs} />
      <ServiceWorkerUpdate />
    </div>
  );
}
