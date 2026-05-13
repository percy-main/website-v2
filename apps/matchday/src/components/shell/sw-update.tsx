import { Button } from "@/components/ui/button.js";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Toast shown when a new service worker is waiting. Tapping "Reload"
 * activates the new SW + reloads the page. Workbox is configured with
 * skipWaiting + clientsClaim so this is mostly a courtesy — but visible
 * confirmation that the upgrade happened, and a manual escape hatch if
 * the auto-apply ever doesn't kick.
 */
export function ServiceWorkerUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (err) => {
      console.warn("SW register failed", err);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="bg-text fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-40 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-lg md:right-6 md:bottom-6 md:left-auto md:max-w-sm"
    >
      <div>
        <div className="font-semibold">New version available</div>
        <div className="text-xs text-white/70">Reload to update Matchday.</div>
      </div>
      <Button
        size="sm"
        tone="ghost"
        className="text-white hover:bg-white/10"
        onClick={() => {
          setNeedRefresh(false);
          void updateServiceWorker(true);
        }}
      >
        Reload
      </Button>
    </div>
  );
}
