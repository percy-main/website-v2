import { cn } from "@/lib/utils";
import {
  BanknoteIcon,
  CalendarDaysIcon,
  CircleCheckIcon,
  HomeIcon,
  type LucideIcon,
  UserIcon,
  UsersIcon,
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
 *   - Official      + Squad + Availability                (6 tabs)
 *   - Admin         + Approvals                           (7 tabs — desktop)
 *
 * Officials are also players, so Donations stays for them. Players never
 * see Squad / Availability.
 */
export function tabsForRole(
  role: "player" | "official" | "admin",
  badges?: { approvals?: number },
): TabDef[] {
  const base: TabDef[] = [
    { to: "/", label: "Home", icon: HomeIcon, end: true },
    { to: "/fixtures", label: "Fixtures", icon: CalendarDaysIcon },
    { to: "/donations", label: "Donations", icon: WalletIcon },
  ];
  const meTab: TabDef = { to: "/me", label: "Me", icon: UserIcon };

  if (role === "player") {
    return [...base, meTab];
  }
  if (role === "official") {
    return [
      base[0],
      { to: "/squad", label: "Squad", icon: UsersIcon },
      { to: "/availability/manage", label: "Availability", icon: CircleCheckIcon },
      base[1],
      base[2],
      meTab,
    ];
  }
  // admin
  return [
    base[0],
    base[1],
    {
      to: "/approvals",
      label: "Approvals",
      icon: BanknoteIcon,
      badge: badges?.approvals,
    },
    base[2],
    meTab,
  ];
}

export function BottomTabBar({ tabs }: { tabs: TabDef[] }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-border bg-surface/95 pb-[max(env(safe-area-inset-bottom),6px)] pt-1 backdrop-blur md:hidden"
      aria-label="Matchday navigation"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "relative flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10.5px] font-medium",
              isActive ? "text-navy dark:text-white" : "text-text-secondary",
            )
          }
        >
          <tab.icon className="size-[22px]" strokeWidth={2.1} />
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="absolute right-[calc(50%-22px)] top-1.5 rounded-full bg-red px-1.5 py-px text-[9px] font-bold text-white">
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
