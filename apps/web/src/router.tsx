import { createBrowserRouter } from "react-router";
import { RequireAuth } from "./components/require-auth.js";
import { RequireElevated } from "./components/require-elevated.js";
import { RequirePermission } from "./components/require-permission.js";
import { RequireVerifiedEmail } from "./components/require-verified-email.js";
import { RouteError } from "./components/route-error.js";
import { AuthLayout } from "./layouts/auth-layout.js";
import { RootLayout } from "./layouts/root-layout.js";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    // Catches render exceptions in any descendant route, plus
    // route-not-found. Reports to NR with the route path so the white-
    // screen failure mode is at least observable. (#182)
    errorElement: <RouteError />,
    children: [
      // Public routes
      {
        index: true,
        lazy: () => import("./pages/home.js"),
      },
      {
        path: "news/:page",
        lazy: () => import("./pages/news/news-list.js"),
      },
      {
        path: "news/article/:id",
        lazy: () => import("./pages/news/news-article.js"),
      },
      {
        path: "news/tag/:tag/:page",
        lazy: () => import("./pages/news/news-by-tag.js"),
      },
      {
        path: "calendar",
        lazy: () => import("./pages/calendar/calendar-overview.js"),
      },
      {
        path: "calendar/:year/:month",
        lazy: () => import("./pages/calendar/calendar-month.js"),
      },
      {
        path: "calendar/event/:id",
        lazy: () => import("./pages/calendar/calendar-event.js"),
      },
      {
        path: "calendar/game/:id",
        lazy: () => import("./pages/calendar/game-detail.js"),
      },
      {
        path: "calendar/game/:id/sponsor",
        lazy: () => import("./pages/calendar/game-sponsor-checkout.js"),
      },
      {
        path: "person",
        lazy: () => import("./pages/person/person-directory.js"),
      },
      {
        path: "person/sponsor/:slug",
        lazy: () => import("./pages/person/sponsor-checkout.js"),
      },
      {
        path: "person/:slug",
        lazy: () => import("./pages/person/person-profile.js"),
      },
      {
        path: "fantasy",
        lazy: () => import("./pages/fantasy/fantasy.js"),
      },
      {
        path: "leaderboard",
        lazy: () => import("./pages/leaderboard/leaderboard-year.js"),
      },
      {
        path: "leaderboard/:year",
        lazy: () => import("./pages/leaderboard/leaderboard-year.js"),
      },
      {
        path: "game/be-the-keeper",
        lazy: () => import("./pages/game/be-the-keeper.js"),
      },
      {
        path: "game/be-the-keeper/leaderboard",
        lazy: () => import("./pages/game/be-the-keeper-leaderboard.js"),
      },
      {
        path: "report-incident",
        lazy: () => import("./pages/report-incident.js"),
      },
      {
        path: "purchase/:priceId",
        lazy: () => import("./pages/purchase/purchase.js"),
      },
      {
        path: "payment/confirm",
        lazy: () => import("./pages/purchase/payment-confirm.js"),
      },
      {
        path: "nets",
        lazy: () => import("./pages/nets.js"),
      },
      {
        path: "availability/:requestId",
        lazy: () => import("./pages/availability/public-availability.js"),
      },

      // Recruit-2026 landing pages
      {
        path: "tell-me-about",
        lazy: () => import("./pages/tell-me-about/index.js"),
      },
      {
        path: "tell-me-about/mens-cricket",
        lazy: () => import("./pages/tell-me-about/mens-cricket.js"),
      },
      {
        path: "tell-me-about/womens-cricket",
        lazy: () => import("./pages/tell-me-about/womens-cricket.js"),
      },
      {
        path: "tell-me-about/junior-boys",
        lazy: () => import("./pages/tell-me-about/junior-boys.js"),
      },
      {
        path: "tell-me-about/junior-girls",
        lazy: () => import("./pages/tell-me-about/junior-girls.js"),
      },

      // Auth routes (minimal layout)
      {
        element: <AuthLayout />,
        children: [
          {
            path: "auth/login",
            lazy: () => import("./pages/auth/login.js"),
          },
          {
            path: "auth/register",
            lazy: () => import("./pages/auth/register.js"),
          },
          {
            path: "auth/registered",
            lazy: () => import("./pages/auth/registered.js"),
          },
          {
            path: "auth/email-confirmed",
            lazy: () => import("./pages/auth/email-confirmed.js"),
          },
          {
            path: "auth/reset-password",
            lazy: () => import("./pages/auth/reset-password.js"),
          },
          {
            path: "auth/logout",
            lazy: () => import("./pages/auth/logout.js"),
          },
        ],
      },

      // Authenticated + verified email routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireVerifiedEmail />,
            children: [
              {
                path: "members",
                lazy: () => import("./pages/members/members-dashboard.js"),
              },
              {
                path: "members/fantasy",
                lazy: () => import("./pages/members/members-fantasy.js"),
              },
              {
                path: "members/availability",
                lazy: () => import("./pages/members/members-availability.js"),
              },
              {
                path: "members/documents/:documentId",
                lazy: () => import("./pages/members/document-viewer.js"),
              },
              // Membership flows
              {
                path: "membership/join",
                lazy: () => import("./pages/membership/membership-join.js"),
              },
              {
                path: "membership/pay",
                lazy: () => import("./pages/membership/membership-pay.js"),
              },
              {
                path: "membership/junior",
                lazy: () => import("./pages/membership/membership-junior.js"),
              },
              // Matchday hub — all members see availability, officials see more
              {
                path: "matchday",
                lazy: () => import("./pages/matchday/matchday-hub.js"),
              },
              // Scout — AI cricket analyst, gated to admin/official roles
              // server-side. The route is mounted for everyone but the API
              // returns 403 for users without the role.
              {
                path: "scout",
                lazy: () => import("./pages/scout/scout.js"),
              },
              {
                path: "scout/:threadId",
                lazy: () => import("./pages/scout/scout.js"),
              },
            ],
          },
        ],
      },

      // Admin routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireVerifiedEmail />,
            children: [
              {
                element: <RequireElevated />,
                children: [
                  {
                    path: "admin",
                    lazy: () => import("./pages/admin/admin-panel.js"),
                  },
                ],
              },
            ],
          },
        ],
      },

      // Official routes (matchday management + availability management)
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireVerifiedEmail />,
            children: [
              {
                element: (
                  <RequirePermission resource="matchday" action="view" />
                ),
                children: [
                  {
                    path: "matchday/teams",
                    lazy: () => import("./pages/official/official.js"),
                  },
                  {
                    path: "matchday/availability",
                    lazy: () => import("./pages/official/availability.js"),
                  },
                  {
                    path: "matchday/availability/:requestId",
                    lazy: () => import("./pages/official/availability.js"),
                  },
                  {
                    path: "matchday/availability/:requestId/:date",
                    lazy: () => import("./pages/official/availability.js"),
                  },
                ],
              },
            ],
          },
        ],
      },

      // Junior manager routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireVerifiedEmail />,
            children: [
              {
                element: <RequirePermission resource="juniors" action="view" />,
                children: [
                  {
                    path: "junior-manager",
                    lazy: () =>
                      import("./pages/junior-manager/junior-manager.js"),
                  },
                ],
              },
            ],
          },
        ],
      },

      // Content pages (MDX) — catch-all for CMS-style pages
      // Must come after all explicit routes so they take precedence
      {
        path: "*",
        lazy: () => import("./pages/content-page.js"),
      },
    ],
  },
]);
