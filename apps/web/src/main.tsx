import "@fontsource-variable/lora";
import "@fontsource-variable/source-sans-3";
// Heavy condensed display face for the experimental "First-Class" content
// theme (riso / screenprint poster look). Self-hosted to keep the no-external-
// fonts policy; stands in for Haettenschweiler / Impact, which have no web font.
import "@fontsource/anton";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./app.css";
import { maybeCaptureAttribution } from "./lib/marketing/attribution.js";
import { applyStoredConsentToGtag } from "./lib/marketing/consent.js";
import "./lib/newrelic.js";
import { AppProviders } from "./providers/app-providers.js";
import { router } from "./router.js";

// Mirror any stored consent record to gtag inside the 500ms wait_for_update
// window, then capture attribution on first campaign-linked hit.
applyStoredConsentToGtag();
maybeCaptureAttribution();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- root element always exists in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
