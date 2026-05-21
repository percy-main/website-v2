import { Button } from "@/components/ui/button.js";
import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Browsers only re-fetch sw.js on a fresh page load. On iOS PWAs that
// means a user has to force-quit before a new deploy is detected, so we
// nudge the registration to check (a) every time the app comes back to
// the foreground and (b) every 30 min for tabs that stay open.
const UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * Toast shown when a new service worker is waiting. Tapping "Reload"
 * activates the new SW + reloads the page. Workbox is configured with
 * skipWaiting + clientsClaim so this is mostly a courtesy - but visible
 * confirmation that the upgrade happened, and a manual escape hatch if
 * the auto-apply ever doesn't kick.
 */
export function ServiceWorkerUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, registration) => {
      registrationRef.current = registration ?? null;
    },
    onRegisterError: (err) => {
      console.warn("SW register failed", err);
    },
  });

  useEffect(() => {
    const check = () => {
      const reg = registrationRef.current;
      if (!reg) return;
      // Swallow: update() rejects on offline / transient network blips
      // and there's nothing useful to do about it.
      reg.update().catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(check, UPDATE_POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, []);

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
