import { AppShell } from "@/components/shell/app-shell.js";
import { RequireAuth } from "@/components/require-auth.js";
import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";

const ComingSoon = lazy(() => import("./pages/coming-soon.js"));

const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            index: true,
            Component: lazy(() => import("./pages/home.js")),
          },
          {
            path: "me",
            Component: lazy(() => import("./pages/me.js")),
          },
          {
            path: "availability/respond",
            Component: lazy(() => import("./pages/availability-respond.js")),
          },
          {
            path: "fixtures",
            Component: lazy(() => import("./pages/fixtures.js")),
          },
          {
            path: "fixture/:matchId",
            Component: lazy(() => import("./pages/fixture-detail.js")),
          },
          {
            path: "matchday/:matchdayId",
            Component: lazy(() => import("./pages/team-sheet.js")),
          },
          {
            path: "donations",
            Component: lazy(() => import("./pages/donations.js")),
          },
          // Phase 3+ surfaces — visible in the nav for officials/admins
          // but render a placeholder until those phases land.
          { path: "squad", Component: ComingSoon },
          { path: "availability/manage", Component: ComingSoon },
          { path: "approvals", Component: ComingSoon },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
