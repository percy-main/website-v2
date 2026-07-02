// Guards the prerenderer's asset-hash parity: the SSR bundle
// (dist/prerender) references content-hashed /assets/ URLs, but only the
// CLIENT build emits those files. Both builds hash the same content with
// the same config so the names should always agree - this asserts they
// actually do, catching config drift or a bundler upgrade changing the
// hash scheme before a deploy ships prerendered pages full of 404 images.
//
// Run after BOTH `pnpm --filter web build` and `pnpm --filter web build:ssr`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../dist");
const ssrDir = resolve(import.meta.dirname, "../dist-server");

if (!existsSync(ssrDir)) {
  console.error(
    `check-ssr-asset-parity: ${ssrDir} not found - run build:ssr first`,
  );
  process.exit(1);
}

const ssrFiles = readdirSync(ssrDir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"));

if (ssrFiles.length === 0) {
  console.error(`check-ssr-asset-parity: no JS bundle found in ${ssrDir}`);
  process.exit(1);
}

const missing = new Set();
let referenced = 0;

for (const file of ssrFiles) {
  const code = readFileSync(join(ssrDir, file), "utf8");
  for (const match of code.matchAll(/["'](\/assets\/[^"'\s?#]+)["']/g)) {
    const assetPath = match[1];
    referenced += 1;
    if (!existsSync(join(distDir, assetPath))) {
      missing.add(assetPath);
    }
  }
}

if (missing.size > 0) {
  console.error(
    `check-ssr-asset-parity: ${String(missing.size)} asset reference(s) in the SSR bundle do not exist in the client build:`,
  );
  for (const assetPath of missing) console.error(`  ${assetPath}`);
  process.exit(1);
}

console.log(
  `check-ssr-asset-parity: OK (${String(referenced)} asset references all present in client build)`,
);
