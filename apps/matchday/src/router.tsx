import { RequireAuth } from "@/components/require-auth.js";
import { RouteErrorBoundary } from "@/components/route-error-boundary.js";
import { AppShell } from "@/components/shell/app-shell.js";
import { lazyWithReload } from "@/lib/lazy-with-reload.js";
import { createBrowserRouter, type RouteObject } from "react-router";

const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            index: true,
            Component: lazyWithReload(() => import("./pages/home.js")),
          },
          {
            path: "me",
            Component: lazyWithReload(() => import("./pages/me.js")),
          },
          {
            path: "availability/respond",
            Component: lazyWithReload(
              () => import("./pages/availability-respond.js"),
            ),
          },
          {
            path: "fixtures",
            Component: lazyWithReload(() => import("./pages/fixtures.js")),
          },
          {
            path: "fixture/:matchId",
            Component: lazyWithReload(
              () => import("./pages/fixture-detail.js"),
            ),
          },
          {
            path: "matchday/:matchdayId",
            Component: lazyWithReload(() => import("./pages/team-sheet.js")),
          },
          {
            path: "donations",
            Component: lazyWithReload(() => import("./pages/donations.js")),
          },
          // Phase 3 official surfaces — lazy-loaded.
          {
            path: "matchday/:matchdayId/edit",
            Component: lazyWithReload(() => import("./pages/matchday-edit.js")),
          },
          {
            path: "matchday/:matchdayId/wrap",
            Component: lazyWithReload(() => import("./pages/matchday-live.js")),
          },
          // Old /live path stays as an alias so any bookmarked or
          // in-flight links land on the new wrap screen until UI links
          // are updated.
          {
            path: "matchday/:matchdayId/live",
            Component: lazyWithReload(() => import("./pages/matchday-live.js")),
          },
          {
            path: "official/availability",
            Component: lazyWithReload(
              () => import("./pages/official-availability.js"),
            ),
          },
          {
            path: "official/availability/new",
            Component: lazyWithReload(
              () => import("./pages/official-availability-new.js"),
            ),
          },
          {
            path: "official/availability/:requestId",
            Component: lazyWithReload(
              () => import("./pages/official-availability-detail.js"),
            ),
          },
          {
            path: "official/availability/:requestId/date/:date",
            Component: lazyWithReload(
              () => import("./pages/official-availability-date.js"),
            ),
          },
          {
            path: "expenses/mine",
            Component: lazyWithReload(() => import("./pages/expenses-mine.js")),
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
