// Local preview of a prerendered document, end-to-end minus AWS: fetches
// live data from the API baked into the SSR bundle, renders through the
// real entry-server + head builder + assembler, and writes the HTML to
// stdout or a file.
//
// Usage:
//   pnpm --filter web build && VITE_API_URL=https://api.v2.percymain.org/api pnpm --filter web build:ssr
//   node scripts/prerender-preview.mjs /club [out.html]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2];
if (!url) {
  console.error(
    "usage: node scripts/prerender-preview.mjs <url-path> [out-file]",
  );
  process.exit(1);
}

process.env.TEMPLATE_PATH ??= resolve(
  import.meta.dirname,
  "../dist/index.html",
);

const { renderDocument } = await import(
  resolve(import.meta.dirname, "../dist-server/lambda.mjs")
);

const html = await renderDocument(url);
const outFile = process.argv[3];
if (outFile) {
  writeFileSync(outFile, html);
  console.error(`wrote ${String(html.length)} bytes to ${outFile}`);
} else {
  process.stdout.write(html);
}
