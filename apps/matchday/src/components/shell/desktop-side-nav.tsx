import type { TabDef } from "@/components/shell/bottom-tab-bar.js";
import { cn } from "@/lib/utils";
import { NavLink } from "react-router";

/**
 * Desktop sidebar mirroring the bottom-tab nav items. Same TabDef list —
 * just rendered as a left rail instead of a bottom bar.
 */
export function DesktopSideNav({ tabs }: { tabs: TabDef[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-border bg-surface px-3 py-5 md:flex md:flex-col md:gap-1">
      <div className="px-2 pb-4">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-navy text-[11px] font-bold tracking-wide text-white">
            PM
          </div>
          <div>
            <div className="text-sm font-bold leading-none">Matchday</div>
            <div className="mt-0.5 text-[11px] text-text-secondary">
              Percy Main CSC
            </div>
          </div>
        </div>
      </div>
      <nav aria-label="Matchday navigation" className="flex flex-col gap-0.5">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-info-bg text-navy dark:text-white"
                  : "text-text-secondary hover:bg-surface-raised",
              )
            }
          >
            <tab.icon className="size-[18px]" strokeWidth={2} />
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-auto rounded-full bg-red px-1.5 py-px text-[10px] font-bold text-white">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
