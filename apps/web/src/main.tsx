import "@fontsource-variable/lora";
import "@fontsource-variable/source-sans-3";
// Heavy condensed display face for the experimental "First-Class" content
// theme (riso / screenprint poster look). Self-hosted to keep the no-external-
// fonts policy; stands in for Haettenschweiler / Impact, which have no web font.
import "@fontsource/anton";
import { hydrate } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./app.css";
import { maybeCaptureAttribution } from "./lib/marketing/attribution.js";
import { applyStoredConsentToGtag } from "./lib/marketing/consent.js";
import "./lib/newrelic.js";
import {
  preloadMatchedRoutes,
  readPrerenderPayload,
} from "./prerender/take-over.js";
import {
  AppProviders,
  createAppQueryClient,
} from "./providers/app-providers.js";
import { routes } from "./routes.js";

// Mirror any stored consent record to gtag inside the 500ms wait_for_update
// window, then capture attribution on first campaign-linked hit.
applyStoredConsentToGtag();
maybeCaptureAttribution();

/**
 * Boot, prerender-aware (take-over.ts): seed the query cache from the
 * document's embedded state and resolve the matched route's lazy module
 * BEFORE the first render, so on a prerendered document React's first
 * commit reproduces the DOM already on screen instead of wiping it with
 * a loading state. On a plain CSR document both steps are cheap no-ops
 * (empty cache seed; the router would await the same lazy import before
 * its first commit anyway).
 */
async function boot() {
  const queryClient = createAppQueryClient();
  const payload = readPrerenderPayload();
  if (payload) hydrate(queryClient, payload.dehydratedState);

  await preloadMatchedRoutes(routes, window.location.pathname);
  const router = createBrowserRouter(routes);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- root element always exists in index.html
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void boot();
