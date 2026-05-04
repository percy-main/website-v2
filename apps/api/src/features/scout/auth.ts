import { requireRole } from "../auth/middleware.ts";

/**
 * Gates Scout routes to users with the `admin` or `official` role.
 * The frontend hide-the-link is just cosmetic; this is the real boundary.
 *
 * Emits 403 (not 401) on a logged-in user without the role, so the absence
 * of Scout from the menu and a 403 from the API tell the same story.
 */
export const requireScoutAccess = requireRole("admin", "official");
