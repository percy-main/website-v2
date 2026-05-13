/**
 * Where the main Percy Main site lives. In production this is
 * https://percymain.org; in dev it's the Vite server on :5173.
 *
 * The matchday app links back to the main site for:
 *  - sign-in / sign-up (RequireAuth redirects here with ?returnTo=)
 *  - paying donations (Stripe flow stays on the main site)
 *  - viewing/editing member details
 */
export const MAIN_SITE_BASE_URL =
  (import.meta.env.VITE_MAIN_SITE_URL as string | undefined) ??
  (import.meta.env.PROD ? "https://percymain.org" : "http://localhost:5173");

export function mainSiteUrl(path: `/${string}`): string {
  return `${MAIN_SITE_BASE_URL}${path}`;
}

/**
 * URL to send unauthenticated users to. Carries `returnTo` so the main
 * site can bounce them back to where they were on matchday.
 */
export function signInUrl(returnTo: string = window.location.href): string {
  return `${MAIN_SITE_BASE_URL}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
