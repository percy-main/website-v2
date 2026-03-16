import { createBrowserRouter } from "react-router";
import { RequireAuth } from "./components/require-auth.js";
import { RequireRole } from "./components/require-role.js";
import { RequireVerifiedEmail } from "./components/require-verified-email.js";
import { AuthLayout } from "./layouts/auth-layout.js";
import { RootLayout } from "./layouts/root-layout.js";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
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
        path: "person",
        lazy: () => import("./pages/person/person-directory.js"),
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
        path: "fantasy/rules",
        lazy: () => import("./pages/fantasy/fantasy-rules.js"),
      },
      {
        path: "leaderboard",
        lazy: () => import("./pages/leaderboard/leaderboard.js"),
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
        path: "legal/privacy",
        lazy: () => import("./pages/legal/privacy.js"),
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
            ],
          },
        ],
      },

      // Admin routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireRole roles={["admin"]} />,
            children: [
              {
                path: "admin",
                lazy: () => import("./pages/admin/admin-panel.js"),
              },
            ],
          },
        ],
      },

      // Official routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireRole roles={["official", "admin"]} />,
            children: [
              {
                path: "official",
                lazy: () => import("./pages/official/official.js"),
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
            element: <RequireRole roles={["junior_manager", "admin"]} />,
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

      // Catch-all
      {
        path: "*",
        lazy: () => import("./pages/not-found.js"),
      },
    ],
  },
]);
