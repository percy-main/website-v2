import { Outlet } from "react-router";

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header>
        <nav>{/* TODO: site navigation */}</nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer>{/* TODO: site footer */}</footer>
    </div>
  );
}
