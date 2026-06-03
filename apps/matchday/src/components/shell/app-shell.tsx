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
  // Fixed-height app shell: the outer box is exactly one dynamic
  // viewport tall (`h-dvh`) and clips overflow, so the page body never
  // scrolls - only <main> does (`overflow-y-auto`). This keeps the
  // browser's address/toolbar chrome from auto-hiding on scroll, which
  // is what let iOS Chrome leave a gap under a `position: fixed` bottom
  // nav (Safari re-anchored it to the visual viewport, Chrome didn't).
  // With the bar now a normal flex child at the foot of the column, it
  // is structurally pinned to the bottom on every browser.
  return (
    <div className="bg-surface-raised text-text flex h-dvh overflow-hidden">
      <DesktopSideNav tabs={tabs} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineIndicator />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <BottomTabBar tabs={tabs} />
      </div>
      <ServiceWorkerUpdate />
    </div>
  );
}
