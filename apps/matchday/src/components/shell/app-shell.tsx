import {
  BottomTabBar,
  tabsForRole,
} from "@/components/shell/bottom-tab-bar.js";
import { DesktopSideNav } from "@/components/shell/desktop-side-nav.js";
import { OfflineIndicator } from "@/components/shell/offline-indicator.js";
import { ServiceWorkerUpdate } from "@/components/shell/sw-update.js";
import { TopBar } from "@/components/shell/top-bar.js";
import { canViewMatchdayAdmin, useSession } from "@/lib/auth-client.js";
import { Outlet } from "react-router";

/**
 * Top-level shell wrapping every authenticated route. Renders the top
 * header on mobile + the side nav on desktop, with the route content
 * in between, the bottom tab bar pinned, and the offline + SW update
 * banners as overlays.
 *
 * Per-user Workbox cache hygiene lives in <RequireAuth /> (the parent
 * route element) — it gates rendering on the cache wipe so this shell
 * + the <Outlet /> children never get the chance to fire useQuery
 * fetches against another user's cached responses.
 */
export function AppShell() {
  const { data: session } = useSession();
  // Anyone with the matchday:view permission gets the official surfaces
  // (Availability tab, past-unfinished card, etc.) - same source of
  // truth as the server-side `requirePermission("matchday", "view")`
  // preHandler, so the UI never offers something the API will 403.
  const role: "player" | "official" = canViewMatchdayAdmin(session?.user)
    ? "official"
    : "player";
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
