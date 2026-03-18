import { SiteFooter } from "@/components/site-footer.js";
import { SiteHeader } from "@/components/site-header.js";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
