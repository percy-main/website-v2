// Deploy-time prebuild step: bake the CURRENT live nav into the bundle
// as react-query initialData (src/generated/nav-snapshot.json), so the
// header's content-section links paint on first render on SPA-shell
// routes (/fantasy, /calendar, ...) instead of popping in when
// GET /api/content/nav resolves. initialDataUpdatedAt: 0 marks it
// immediately stale, so the client still refetches in the background -
// staleness is bounded by one page load, not one deploy.
//
// Fail-soft BY DESIGN: local/offline builds and API outages keep the
// committed empty snapshot (today's behaviour) rather than failing the
// build.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const NAV_URL =
  process.env.NAV_SNAPSHOT_URL ??
  "https://api.v2.percymain.org/api/content/nav";
const OUT_PATH = resolve(
  import.meta.dirname,
  "../src/generated/nav-snapshot.json",
);

try {
  const response = await fetch(NAV_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  const nav = await response.json();
  if (!Array.isArray(nav?.items) || !Array.isArray(nav?.removed)) {
    throw new Error("Response is not a nav payload");
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(nav, null, 2)}\n`);
  console.log(
    `fetch-nav-snapshot: baked ${String(nav.items.length)} nav item(s) from ${NAV_URL}`,
  );
} catch (error) {
  console.warn(
    `fetch-nav-snapshot: keeping committed snapshot (${error instanceof Error ? error.message : String(error)})`,
  );
}
