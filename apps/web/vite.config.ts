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

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    imagetools({
      defaultDirectives: (url) => {
        if (url.searchParams.has("optimise")) {
          return new URLSearchParams(
            "w=320;640;960;1280;1920&format=avif;webp;jpg&as=picture",
          );
        }
        return new URLSearchParams();
      },
    }),
    gtagHtmlPlugin(mode),
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
