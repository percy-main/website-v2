import { API_BASE } from "@/lib/api-client.js";

/**
 * Fetch the server-generated team news PNG and hand it to the user.
 *
 * The backend route is officials-only; this helper assumes the caller
 * has already gated the affordance behind `canViewMatchdayAdmin`. On
 * mobile we try Web Share first (so it lands in the user's photo roll
 * / a chat) and fall back to a download anchor if share is unavailable
 * or the user cancels.
 */
export async function shareOrDownloadTeamNewsImage(opts: {
  matchId: string;
  isHome: boolean;
  matchTime: string | null;
}): Promise<void> {
  const base = API_BASE.replace(/\/$/, "");
  const params = new URLSearchParams({ isHome: String(opts.isHome) });
  if (opts.matchTime) params.set("matchTime", opts.matchTime);
  const url = `${base}/matchday/${encodeURIComponent(opts.matchId)}/team-news-image?${params.toString()}`;

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? detail;
    } catch {
      // not JSON, keep the status text
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const filename = `team-news-${opts.matchId}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Team news" });
      return;
    } catch {
      // user cancelled or share failed - fall through to download
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
