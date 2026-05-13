import { BottomTabBar, tabsForRole } from "@/components/shell/bottom-tab-bar.js";
import { DesktopSideNav } from "@/components/shell/desktop-side-nav.js";
import { OfflineIndicator } from "@/components/shell/offline-indicator.js";
import { ServiceWorkerUpdate } from "@/components/shell/sw-update.js";
import { TopBar } from "@/components/shell/top-bar.js";
import { useSession } from "@/lib/auth-client.js";
import { Outlet } from "react-router";

/**
 * Top-level shell wrapping every authenticated route. Renders the top
 * header on mobile + the side nav on desktop, with the route content
 * in between, the bottom tab bar pinned, and the offline + SW update
 * banners as overlays.
 */
export function AppShell() {
  const { data: session } = useSession();
  // Coarse role detection. better-auth's admin plugin stores role on the
  // user. Fallback to "player" for everyone else. The plan keeps roles
  // flat — "official" is a per-team membership, not a global role, so for
  // now we treat anyone with an admin role as also seeing official tabs.
  // Phase 3+ will resolve effective role from per-team membership.
  const role: "player" | "official" | "admin" = (() => {
    const r =
      (session?.user as { role?: string | null } | undefined)?.role ?? "";
    if (r.includes("admin")) return "admin";
    if (r === "official") return "official";
    return "player";
  })();
  const tabs = tabsForRole(role);
  return (
    <div className="flex min-h-dvh bg-surface-raised text-text">
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
