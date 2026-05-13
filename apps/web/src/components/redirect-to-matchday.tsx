import { useEffect } from "react";
import { useParams } from "react-router";

/**
 * Redirect the user to the matchday PWA at matchday.percymain.org. The
 * old apps/web matchday pages (`/matchday`, `/official/availability`,
 * etc.) point at this component so existing bookmarks and email links
 * keep working — we land here, replace location, and on resolve the
 * matchday-app SPA picks up where the user expected.
 *
 * SPAs can't issue a true HTTP 301; `window.location.replace` is the
 * closest equivalent and stays out of the back-stack so the user doesn't
 * land back on the redirect page on a back-button press.
 *
 * `<meta http-equiv="refresh">` would be a fallback for no-JS clients
 * but the main site is JS-required anyway, so we don't render one.
 *
 * Keep this component around for ≥ 3 months after cutover (per
 * phases/6-cutover.md) so email link rot doesn't bite.
 */

const MATCHDAY_BASE =
  (import.meta.env.VITE_MATCHDAY_URL as string | undefined) ??
  (import.meta.env.PROD
    ? "https://matchday.percymain.org"
    : "http://localhost:5175");

interface Props {
  /**
   * Target path on matchday.percymain.org. The string can include
   * `:paramName` placeholders that we'll substitute from useParams().
   * Examples:
   *   - "/"                                       → root
   *   - "/matchday/:matchId"                      → team sheet
   *   - "/official/availability/:requestId/date/:date" → per-date picker
   */
  target: string;
}

export function RedirectToMatchday({ target }: Props) {
  const params = useParams();
  useEffect(() => {
    let path = target;
    for (const [k, v] of Object.entries(params)) {
      if (v) {
        path = path.replace(`:${k}`, encodeURIComponent(v));
      }
    }
    window.location.replace(`${MATCHDAY_BASE}${path}`);
  }, [target, params]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-stone-600">
      <p className="text-sm">Taking you to the Matchday app…</p>
      <p className="text-xs">
        If nothing happens,{" "}
        <a
          href={`${MATCHDAY_BASE}/`}
          className="font-medium underline"
        >
          tap here
        </a>
        .
      </p>
    </div>
  );
}
