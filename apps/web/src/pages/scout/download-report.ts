import { api, callApi } from "@/lib/api-client";

/**
 * Fetch a fresh signed download URL for a Scout report and trigger the
 * download via a temporary anchor.
 *
 * window.location.assign() is unsafe for a downloadable URL: Firefox and
 * some embedded webviews navigate away from the SPA when the response is
 * served, and any blip in Content-Disposition headers leaves the user on
 * a blank page with the chat unloaded. A throwaway <a download> element
 * is the canonical "trigger a download without losing the page" pattern
 * — the browser handles the GET in a hidden context and our SPA stays
 * mounted.
 */
export async function downloadScoutReport(reportId: string): Promise<void> {
  const { url } = await callApi(
    api.GET("/api/scout/reports/{reportId}/download", {
      params: { path: { reportId } },
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  // Empty `download` defers the filename to the server's Content-Disposition.
  a.download = "";
  a.rel = "noopener noreferrer";
  // Some browsers require the anchor to be in the DOM for click() to work.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
