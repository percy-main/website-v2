import { AppShell } from "@/components/shell/app-shell.js";
import { RequireAuth } from "@/components/require-auth.js";
import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";

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
          // Phase 3 official surfaces — lazy-loaded.
          {
            path: "squad",
            Component: lazy(() => import("./pages/squad.js")),
          },
          {
            path: "squad/new",
            Component: lazy(() => import("./pages/squad-new.js")),
          },
          {
            path: "matchday/:matchdayId/edit",
            Component: lazy(() => import("./pages/matchday-edit.js")),
          },
          {
            path: "matchday/:matchdayId/confirm",
            Component: lazy(() => import("./pages/matchday-confirm.js")),
          },
          {
            path: "matchday/:matchdayId/live",
            Component: lazy(() => import("./pages/matchday-live.js")),
          },
          {
            path: "official/availability",
            Component: lazy(() => import("./pages/official-availability.js")),
          },
          {
            path: "official/availability/new",
            Component: lazy(
              () => import("./pages/official-availability-new.js"),
            ),
          },
          {
            path: "official/availability/:requestId",
            Component: lazy(
              () => import("./pages/official-availability-detail.js"),
            ),
          },
          {
            path: "official/availability/:requestId/date/:date",
            Component: lazy(
              () => import("./pages/official-availability-date.js"),
            ),
          },
          {
            path: "expenses/mine",
            Component: lazy(() => import("./pages/expenses-mine.js")),
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
