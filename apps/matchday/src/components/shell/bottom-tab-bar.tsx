import { cn } from "@/lib/utils";
import {
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
 *
 * Officials are also players, so Donations stays for them. Players never
 * see Squad / Availability. Admin surfaces (expense approvals, fee rate
 * admin) stay on the main site — not duplicated here.
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
    { to: "/squad", label: "Squad", icon: UsersIcon },
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
            <span className="absolute right-[calc(50%-22px)] top-1.5 rounded-full bg-red px-1.5 py-px text-[9px] font-bold text-white">
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
