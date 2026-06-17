/**
 * "First-Class" content theme (experimental) — a riso / screenprint poster
 * visual language applied to the PUBLIC CONTENT pages only.
 *
 * The theme is opt-in per route via a `fc-theme` class on <html> (toggled in
 * RootLayout). Everything under that class re-points the core design tokens to
 * the paper/orange/navy palette and switches headings to the condensed display
 * face, so existing components shift palette without per-file edits. Admin,
 * members, auth, scout and the junior-manager tools keep the standard club
 * theme and are deliberately excluded.
 *
 * This single predicate is the source of truth, shared by the class toggle and
 * by the chrome (header / footer) that render theme-aware variants.
 */

/** Route prefixes that keep the standard club theme (never First-Class). */
const NON_THEMED_PREFIXES = [
  "/auth",
  "/members",
  "/admin",
  "/scout",
  "/junior-manager",
] as const;

/** The class added to <html> while a First-Class content route is active. */
export const FC_THEME_CLASS = "fc-theme";

/** True when the given pathname is a public content route that gets the theme. */
export function isFcThemeRoute(pathname: string): boolean {
  return !NON_THEMED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
