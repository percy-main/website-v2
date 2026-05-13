import { Button } from "@/components/ui/button.js";
import { ShareIcon, SmartphoneIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Inline "install Matchday" card.
 *
 * Two distinct UXes:
 *
 *  - **Chrome / Edge / Android.** Browsers fire `beforeinstallprompt`
 *    when the PWA meets the install criteria (manifest + SW + repeat
 *    visit). We catch the event, suppress the native mini-infobar, and
 *    show a tappable card. Tapping the install button triggers the
 *    cached event's `prompt()`.
 *
 *  - **iOS Safari.** No `beforeinstallprompt` exists. We show a separate
 *    card with the manual "Share → Add to Home Screen" instructions and
 *    only when not already standalone.
 *
 * Dismissals are stickied to localStorage so the card doesn't keep
 * resurfacing. Cleared automatically if the install actually completes.
 */

const DISMISS_KEY = "matchday-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem(DISMISS_KEY) === "1"
      : false,
  );

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      // Stop Chrome's mini-infobar; we'll surface our own card.
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      // The browser confirms install completed — clear state + dismissal.
      setBipEvent(null);
      localStorage.removeItem(DISMISS_KEY);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (dismissed) return null;
  if (isStandalone()) return null;

  if (bipEvent) {
    return (
      <Card
        onDismiss={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
      >
        <CardBody
          title="Install Matchday"
          body="Add it to your home screen for one-tap access on match day."
          action={
            <Button
              tone="primary"
              size="sm"
              onClick={() => {
                void bipEvent.prompt().then(async () => {
                  const choice = await bipEvent.userChoice;
                  if (choice.outcome === "accepted") {
                    setBipEvent(null);
                  }
                });
              }}
            >
              Install
            </Button>
          }
        />
      </Card>
    );
  }

  if (isIOS()) {
    return (
      <Card
        onDismiss={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
      >
        <CardBody
          title="Install on iPhone"
          body="Tap Share, then Add to Home Screen."
          action={
            <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
              <ShareIcon className="size-3.5" /> Share menu
            </span>
          }
        />
      </Card>
    );
  }

  return null;
}

function Card({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="relative rounded-2xl border border-info-bg bg-info-bg p-4">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-text-secondary hover:bg-white/60"
      >
        <XIcon className="size-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white">
          <SmartphoneIcon className="size-5 text-navy" />
        </div>
        {children}
      </div>
    </div>
  );
}

function CardBody({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-text-secondary">{body}</p>
      <div className="mt-2">{action}</div>
    </div>
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // display-mode: standalone — installed PWAs on Chromium/Edge/Android.
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari uses a non-standard prop on navigator.
  const nav = window.navigator as { standalone?: boolean };
  return nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // Modern iPad pretends to be Mac, but `maxTouchPoints > 1` still gives
  // it away — kept simple here since the worst case is showing the wrong
  // instructions to a desktop Mac user who can't install anyway.
  return /iPhone|iPad|iPod/.test(ua);
}
