import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { defineConfig } from "vite";
import { imagetools } from "vite-imagetools";

export default defineConfig({
  plugins: [
    mdx({
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
      providerImportSource: "@mdx-js/react",
    }),
    react(),
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
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: [
            "react",
            "react-dom",
            "react-router",
            "@tanstack/react-query",
          ],
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
    },
  },
});
