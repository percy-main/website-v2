import { API_BASE } from "@/lib/api-client.js";

/**
 * Fetch the server-generated team news PNG and hand it to the user.
 *
 * Uses raw fetch (not the openapi-fetch typed client) because the
 * endpoint returns binary PNG bytes - the typed client only handles
 * application/json responses. Same pattern as the fantasy share button.
 *
 * The backend route is officials-only; this helper assumes the caller
 * has already gated the affordance behind `canViewMatchdayAdmin`. The
 * backend derives home/away + match time from the play-cricket fixture
 * itself, so callers don't pass them. On mobile we try Web Share first;
 * if the user cancels the share sheet we treat that as "done" (no
 * download fallback). Only unsupported share or a real share failure
 * falls through to a download anchor.
 */
export async function shareOrDownloadTeamNewsImage(opts: {
  matchId: string;
}): Promise<void> {
  const base = API_BASE.replace(/\/$/, "");
  const url = `${base}/matchday/${encodeURIComponent(opts.matchId)}/team-news-image`;

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(res.statusText || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const filename = `team-news-${opts.matchId}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Team news" });
      return;
    } catch (err) {
      // User cancelled the share sheet: that's a deliberate "no" -
      // not a signal to silently dump the file into Downloads. Only
      // a non-abort failure should fall through to the download path.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
