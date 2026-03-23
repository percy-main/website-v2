/**
 * New Relic Browser agent (NPM install method).
 *
 * Instantiates the BrowserAgent with config values sourced from
 * VITE_NEW_RELIC_* env vars at build time. These values come from the
 * Copy/Paste JavaScript snippet on the app's Application Settings page
 * in New Relic.
 *
 * When the license key is not set (e.g. local dev), the agent is not loaded.
 */

import { BrowserAgent } from "@newrelic/browser-agent/loaders/browser-agent";

const licenseKey = import.meta.env.VITE_NEW_RELIC_LICENSE_KEY as
  | string
  | undefined;
const applicationID = import.meta.env.VITE_NEW_RELIC_APP_ID as
  | string
  | undefined;
const accountID = import.meta.env.VITE_NEW_RELIC_ACCOUNT_ID as
  | string
  | undefined;

if (licenseKey && applicationID && accountID) {
  new BrowserAgent({
    init: {
      distributed_tracing: {
        enabled: true,
        cors_use_tracecontext_headers: true,
        cors_use_newrelic_header: true,
        allowed_origins: ["https://api.v2.percymain.org"],
      },
      privacy: { cookies_enabled: true },
      ajax: { deny_list: ["bam.eu01.nr-data.net"] },
      session_replay: {
        enabled: true,
        block_selector: "",
        mask_text_selector: "*",
        sampling_rate: 10.0,
        error_sampling_rate: 100.0,
        mask_all_inputs: true,
        collect_fonts: true,
        inline_images: false,
        fix_stylesheets: true,
        preload: false,
      },
      performance: { capture_measures: true },
      browser_consent_mode: { enabled: false },
    },
    info: {
      beacon: "bam.eu01.nr-data.net",
      errorBeacon: "bam.eu01.nr-data.net",
      licenseKey,
      applicationID,
      sa: 1,
    },
    loader_config: {
      accountID,
      trustKey: accountID,
      agentID: applicationID,
      licenseKey,
      applicationID,
    },
  });
}
