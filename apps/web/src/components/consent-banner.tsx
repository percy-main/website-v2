import {
  needsConsent,
  onConsentReopenRequested,
  setConsent,
} from "@/lib/marketing/consent.js";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export function ConsentBanner() {
  const [open, setOpen] = useState<boolean>(() => needsConsent());
  const reopenedRef = useRef(false);

  useEffect(() => {
    return onConsentReopenRequested(() => {
      reopenedRef.current = true;
      setOpen(true);
    });
  }, []);

  if (!open) return null;

  const handle = (state: "granted" | "denied") => {
    setConsent(state, reopenedRef.current ? "settings-link" : "banner");
    reopenedRef.current = false;
    setOpen(false);
  };

  return (
    <>
      <div
        aria-hidden
        className="h-[calc(env(safe-area-inset-bottom)+112px)]"
      />
      <div
        role="region"
        aria-label="Cookie consent"
        className="bg-primary fixed inset-x-0 bottom-0 z-50 border-t border-white/10 text-white shadow-lg"
      >
        <div className="container mx-auto flex flex-col gap-3 px-6 py-4 text-sm md:flex-row md:items-center md:justify-between">
          <p className="leading-relaxed">
            A quick note: we run Google Ads to bring new players to the club,
            and we use a couple of cookies to see which ones work. You can say
            no; the site works the same either way.{" "}
            <Link
              to="/legal/privacy"
              className="text-cta underline underline-offset-2 hover:text-[#f7864f]"
            >
              Privacy
            </Link>
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => handle("granted")}
              className="bg-cta hover:bg-cta-dark rounded px-4 py-2 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => handle("denied")}
              className="rounded bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
