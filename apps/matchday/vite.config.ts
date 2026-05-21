import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    VitePWA({
      // Register an auto-updating service worker. Phase 1 ships the
      // skeleton only — no offline caching yet (that's phase 5). The
      // important part is that the SW is registered and we can roll
      // a new version with a "tap to reload" toast.
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Percy Main Matchday",
        short_name: "Matchday",
        description:
          "Percy Main CSC — availability, team sheets, donations, and match-day tools.",
        theme_color: "#0b1a2a",
        background_color: "#fafaf9",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        // App shortcuts (long-press / right-click the home-screen icon
        // on Android + supported desktop). Picked to match the most
        // common reasons a player opens the app.
        shortcuts: [
          {
            name: "Answer availability",
            short_name: "Availability",
            url: "/availability/respond",
            description: "Respond to open availability requests",
          },
          {
            name: "Today's match",
            short_name: "Match day",
            url: "/squad",
            description: "Captain & official view of today's match",
          },
        ],
        icons: [
          {
            src: "/images/favicon/web-app-manifest-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/images/favicon/web-app-manifest-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Pre-cache the app shell. New deploys win immediately via
        // skipWaiting + clientsClaim; cleanupOutdatedCaches keeps the
        // old SW's caches from sticking around as zombies.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Layer the push + notificationclick handlers on top of the
        // generated workbox SW via importScripts. Keeps the existing
        // generateSW pipeline intact - we just need event listeners,
        // not a hand-rolled SW.
        importScripts: ["/push-handler.js"],
        // SPA fallback — any navigation request to a path we don't have
        // cached falls back to the precached index.html (offline launch).
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Phase 5 — runtime caching for the GET endpoints that need to
        // work pitch-side. StaleWhileRevalidate so a stale-but-usable
        // response paints instantly, while the network update comes in
        // behind it for the next visit.
        runtimeCaching: [
          {
            urlPattern: /\/api\/availability\/active/,
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "matchday-availability-active",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              fetchOptions: { credentials: "include" },
            },
          },
          {
            urlPattern: /\/api\/matchday\/[^/]+\/public$/,
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "matchday-team-sheet",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              fetchOptions: { credentials: "include" },
            },
          },
          {
            // Anchored: only match the list endpoint, not /api/charges/*
            // children — if a write endpoint is ever added under this
            // path the StaleWhileRevalidate handler would intercept it
            // (the `method: "GET"` option only blocks *caching* the
            // response, not the URL match).
            urlPattern: /\/api\/charges$/,
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "matchday-charges",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              fetchOptions: { credentials: "include" },
            },
          },
          {
            urlPattern: /\/api\/games(\/[^/]+)?$/,
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "matchday-games",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 12 },
              cacheableResponse: { statuses: [0, 200] },
              fetchOptions: { credentials: "include" },
            },
          },
          // BackgroundSync for the writes that pitch-side captains make.
          // If the request fails with a network error (4G drops out), it
          // gets enqueued and replayed on the next `sync` event. Safari
          // doesn't support BackgroundSync; in-memory react-query retries
          // are the fallback there.
          {
            urlPattern: /\/api\/matchday\/[^/]+\/players\/[^/]+\/mark-paid$/,
            handler: "NetworkOnly",
            method: "POST",
            options: {
              backgroundSync: {
                name: "matchday-mark-paid",
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
          {
            urlPattern: /\/api\/matchday\/[^/]+\/expenses$/,
            handler: "NetworkOnly",
            method: "POST",
            options: {
              backgroundSync: {
                name: "matchday-expenses",
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
          {
            // Player-side respond endpoint — POST not PUT. Earlier
            // BG-sync rule listened on the official-only per-date PUT
            // (matchdayManage-gated) which the UI doesn't use; players
            // hit POST /respond instead. See availability-respond.tsx.
            urlPattern: /\/api\/availability\/requests\/[^/]+\/respond$/,
            handler: "NetworkOnly",
            method: "POST",
            options: {
              backgroundSync: {
                name: "matchday-availability-respond",
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            /[\\/]node_modules[\\/](\.pnpm[\\/])?(@tanstack[\\/]react-query|react|react-dom|react-router|scheduler)([\\/@]|$)/.test(
              id,
            )
          ) {
            return "vendor";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
