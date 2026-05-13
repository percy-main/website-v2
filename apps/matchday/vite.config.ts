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
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/images/favicon/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/images/favicon/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/images/favicon/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Default workbox behaviour pre-caches index.html, which would
        // serve stale app shells forever. Force-skip waiting + clean
        // out the previous SW's caches so a new deploy takes effect
        // on the next page load.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Phase 5 will expand this with route-level runtime caching.
        // For phase 1, just pre-cache the built assets.
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
