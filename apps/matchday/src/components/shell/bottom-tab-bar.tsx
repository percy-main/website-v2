import { cn } from "@/lib/utils";
import {
  CalendarDaysIcon,
  CircleCheckIcon,
  HomeIcon,
  type LucideIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { NavLink } from "react-router";

export interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  end?: boolean;
}

/**
 * Build the tab list for the user's effective role. Per design:
 *
 *   - Player        Home · Fixtures · Donations · Me      (4 tabs)
 *   - Official      + Availability                        (5 tabs)
 *
 * Officials are also players, so Donations stays for them. Players never
 * see Availability. Admin surfaces (expense approvals, fee rate admin)
 * stay on the main site - not duplicated here. The old Squad tab was
 * dropped: per-team rollups now live on the Home dashboard's "Needs
 * attention" card, and matchday-management actions hang off
 * fixture-detail directly.
 */
export function tabsForRole(role: "player" | "official"): TabDef[] {
  const home: TabDef = { to: "/", label: "Home", icon: HomeIcon, end: true };
  const fixtures: TabDef = {
    to: "/fixtures",
    label: "Fixtures",
    icon: CalendarDaysIcon,
  };
  const donations: TabDef = {
    to: "/donations",
    label: "Donations",
    icon: WalletIcon,
  };
  const me: TabDef = { to: "/me", label: "Me", icon: UserIcon };

  if (role === "player") {
    return [home, fixtures, donations, me];
  }
  return [
    home,
    {
      to: "/official/availability",
      label: "Availability",
      icon: CircleCheckIcon,
    },
    fixtures,
    donations,
    me,
  ];
}

export function BottomTabBar({ tabs }: { tabs: TabDef[] }) {
  return (
    <nav
      className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t pt-1 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur md:hidden"
      aria-label="Matchday navigation"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              // tracking-tight + nowrap + text-[10px] keeps "Availability"
              // / "Donations" on a single line even in the 6-tab official
              // layout on a 360px phone. Slight horizontal overspill into
              // the px-1 buffer is fine; wrapping looks worse.
              "relative flex flex-col items-center justify-center gap-0.5 overflow-hidden px-0.5 py-2 text-[10px] font-medium tracking-tight whitespace-nowrap",
              isActive ? "text-navy dark:text-white" : "text-text-secondary",
            )
          }
        >
          <tab.icon className="size-[22px]" strokeWidth={2.1} />
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="bg-red absolute top-1.5 right-[calc(50%-22px)] rounded-full px-1.5 py-px text-[9px] font-bold text-white">
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
