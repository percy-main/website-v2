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

// NR Browser agent attaches `newrelic` to window after load. This
// declaration narrows the type to the methods we actually use.
declare global {
  interface Window {
    newrelic?: {
      noticeError: (
        err: Error,
        attributes?: Record<string, string | number | boolean>,
      ) => void;
    };
  }
}

const licenseKey = import.meta.env.VITE_NEW_RELIC_LICENSE_KEY as
  | string
  | undefined;
const applicationID = import.meta.env.VITE_NEW_RELIC_APP_ID as
  | string
  | undefined;
const accountID = import.meta.env.VITE_NEW_RELIC_ACCOUNT_ID as
  | string
  | undefined;

/**
 * Wrap a fetch with a noticeError on non-OK / network failure so S3
 * presigned PUTs and other raw fetches that can't go through the
 * typed client still surface in NR Browser.
 *
 * Throws on failure so the caller can decide what to do (toast,
 * retry, etc). Returns the Response on success.
 */
export async function noticedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  attributes: Record<string, string | number | boolean> = {},
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  // Try to keep query strings out of NR custom attrs (URLs may carry
  // S3 presigned-URL query params containing signatures).
  const path = (() => {
    try {
      return new URL(url, window.location.origin).pathname;
    } catch {
      return url;
    }
  })();
  const notice = (
    err: Error,
    attrs: Record<string, string | number | boolean>,
  ) => {
    if (window.newrelic) {
      window.newrelic.noticeError(err, attrs);
    } else {
      // NR Browser agent isn't loaded (local dev, ad-blocker, missing
      // VITE_NEW_RELIC_LICENSE_KEY). Drop to console so the failure
      // is at least visible while debugging instead of disappearing
      // silently.
      console.error("noticedFetch (NR not loaded):", err.message, attrs);
    }
  };
  try {
    const res = await fetch(input, init);
    if (!res.ok) {
      const err = new Error(
        `noticed_fetch_failed status=${res.status} ${path}`,
      );
      notice(err, { ...attributes, path, status: res.status });
      throw err;
    }
    return res;
  } catch (err) {
    if (
      !(err instanceof Error && err.message.startsWith("noticed_fetch_failed"))
    ) {
      notice(err as Error, { ...attributes, path });
    }
    throw err;
  }
}

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
