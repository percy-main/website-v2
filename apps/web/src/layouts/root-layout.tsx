import { ConsentBanner } from "@/components/consent-banner.js";
import { SiteFooter } from "@/components/site-footer.js";
import { SiteHeader } from "@/components/site-header.js";
import { FC_THEME_CLASS, isFcThemeRoute } from "@/lib/fc-theme.js";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * Applies the experimental First-Class theme to public content routes by
 * toggling `fc-theme` on <html>. That theme has no dark variant, so dark mode
 * is suppressed while it is active and restored (from the stored preference)
 * on the standard-theme routes (admin / members / auth / scout).
 */
function ContentThemeClass() {
  const { pathname } = useLocation();
  useEffect(() => {
    const root = document.documentElement;
    if (isFcThemeRoute(pathname)) {
      root.classList.add(FC_THEME_CLASS);
      root.classList.remove("dark");
      return;
    }
    root.classList.remove(FC_THEME_CLASS);
    const stored = localStorage.getItem("percy-theme");
    const dark =
      stored === "dark" ||
      (stored !== "light" &&
        window.matchMedia("(prefers-color-scheme:dark)").matches);
    root.classList.toggle("dark", dark);
  }, [pathname]);
  return null;
}

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <ContentThemeClass />
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <ConsentBanner />
    </div>
  );
}
