import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { imagetools } from "vite-imagetools";

/**
 * Strip the marketing gtag block from index.html when the GA4 measurement id
 * is not present at build time. Keeps local dev output clean of Google
 * network requests and avoids shipping an inert gtag stub.
 *
 * The block is delimited by `<!-- pm-gtag:start -->` / `<!-- pm-gtag:end -->`
 * in index.html. When VITE_GOOGLE_ADS_CONVERSION_ID is absent we also drop
 * just the `gtag('config', …ads…)` line (kept inside the same block with a
 * nested marker).
 */
function gtagHtmlPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "");
  const ga4 = env.VITE_GA4_MEASUREMENT_ID;
  const adsId = env.VITE_GOOGLE_ADS_CONVERSION_ID;
  return {
    name: "pm-marketing-gtag",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!ga4) {
          return html.replace(
            /<!-- pm-gtag:start -->[\s\S]*?<!-- pm-gtag:end -->/,
            "",
          );
        }
        let out = html;
        if (!adsId) {
          out = out.replace(
            /<!-- pm-gtag-ads:start -->[\s\S]*?<!-- pm-gtag-ads:end -->/,
            "",
          );
        }
        return out;
      },
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => ({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    imagetools({
      defaultDirectives: (url) => {
        if (url.searchParams.has("optimise")) {
          // "jpeg", not the "jpg" alias: imagetools names the output file
          // from the directive on a cache miss but from sharp's reported
          // format ("jpeg") on a disk-cache hit. With "jpg", a cold client
          // build emits .jpg while the warm SSR build right after
          // references .jpeg - prerendered pages then point at files that
          // don't exist (caught by check-ssr-asset-parity in deploy).
          return new URLSearchParams(
            "w=320;640;960;1280;1920&format=avif;webp;jpeg&as=picture",
          );
        }
        return new URLSearchParams();
      },
    }),
    gtagHtmlPlugin(mode),
  ],
  // The prerenderer bundle (build:ssr) ships to Lambda with no
  // node_modules: bundle every dependency in. Asset imports still resolve
  // to the same content-hashed /assets/ URLs as the client build - CI
  // asserts that parity (scripts/check-ssr-asset-parity.mjs).
  ...(isSsrBuild ? { ssr: { noExternal: true } } : {}),
  build: {
    // The Lambda zip doesn't serve static files; don't copy public/ into
    // the SSR outDir.
    ...(isSsrBuild ? { copyPublicDir: false } : {}),
    rollupOptions: {
      output: isSsrBuild
        ? {
            // The Lambda zip ships no package.json, so Node only treats
            // the bundle as ESM via the .mjs extension.
            entryFileNames: "[name].mjs",
            chunkFileNames: "chunks/[name]-[hash].mjs",
          }
        : {
            manualChunks(id) {
              if (
                /[\\/]node_modules[\\/](\.pnpm[\\/])?(@tanstack[\\/]react-query|react|react-dom|react-router|scheduler)([\\/@]|$)/.test(
                  id,
                )
              ) {
                return "vendor";
              }
              return undefined;
            },
          },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The real package registers a web component at import time -
      // browser-only; the prerender bundle renders nothing in its place.
      ...(isSsrBuild
        ? {
            "add-to-calendar-button-react": path.resolve(
              __dirname,
              "./src/prerender/stubs/add-to-calendar-button.tsx",
            ),
          }
        : {}),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // In prod CloudFront serves /uploads/* from the uploads bucket;
      // locally that bucket lives in LocalStack, so editor-uploaded
      // content images (/uploads/content/...) resolve in dev too.
      "/uploads": {
        target: "http://localhost:4566",
        changeOrigin: true,
        rewrite: (p) => `/percy-main-receipts-local${p}`,
      },
    },
  },
}));
