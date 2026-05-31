import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";

/**
 * Shared primary-action bar for full-screen matchday forms / detail
 * pages.
 *
 * On mobile it pins to the bottom of the viewport, but offset *above*
 * the fixed bottom tab bar (its ~72px height + the iOS home-indicator
 * safe area) so the buttons are never hidden behind the nav - the
 * recurring layout bug every page used to re-introduce by hand-rolling
 * `fixed inset-x-0 bottom-0 z-30`, which collides with the equally
 * `z-30` <BottomTabBar />. The offset mirrors AppShell's <main>
 * padding. On desktop there is no bottom nav, so the bar drops back
 * into normal flow at the foot of the content column (`md:static`).
 *
 * `className` is forwarded to the inner max-width row so callers can
 * tweak button alignment (defaults to right-aligned).
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="border-border bg-surface/95 fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 rounded-2xl border shadow-[0_8px_30px_-4px_rgba(0,0,0,0.28)] backdrop-blur md:static md:inset-x-auto md:bottom-auto md:rounded-none md:border-0 md:border-t md:shadow-none">
      <div
        className={cn(
          "mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 py-3",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
