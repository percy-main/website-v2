import react from "@vitejs/plugin-react";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { defineConfig } from "vite";

const emailDir = join(process.cwd(), "../api/.emails");

function emailApi() {
  return {
    name: "email-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/emails", async (_req, res) => {
        try {
          const files = await readdir(emailDir);
          const jsonFiles = files
            .filter((f) => f.endsWith(".json"))
            .sort()
            .reverse();

          const emails = await Promise.all(
            jsonFiles.map(async (f) => {
              const timestamp = f.replace(".json", "");
              const meta = JSON.parse(
                await readFile(join(emailDir, f), "utf-8"),
              );
              return { id: timestamp, ...meta };
            }),
          );

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(emails));
        } catch {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify([]));
        }
      });

      server.middlewares.use("/api/email/", async (req, res) => {
        try {
          const id = decodeURIComponent(req.url?.slice(1) ?? "");
          const html = await readFile(join(emailDir, `${id}.html`), "utf-8");
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), emailApi()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
