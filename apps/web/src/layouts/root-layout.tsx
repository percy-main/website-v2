import { Outlet } from "react-router";
import { SiteFooter } from "@/components/site-footer.js";
import { SiteHeader } from "@/components/site-header.js";

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
