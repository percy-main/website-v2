import {
  checkPermission,
  hasAdminPanelAccess,
  hasAnyElevatedRole,
  hasClubWideAccess,
  type Action,
  type Resource,
} from "@percy-main/shared/auth/permissions";
import { useSession } from "../lib/auth-client.js";

/**
 * Synchronous local permission check against the user's role(s).
 * Returns:
 *   - { isPending: true, allowed: false } while the session is loading
 *   - { isPending: false, allowed: boolean } once resolved (false if signed out)
 */
export function useHasPermission<R extends Resource>(
  resource: R,
  action: Action<R>,
): { isPending: boolean; allowed: boolean } {
  const { data: session, isPending } = useSession();
  if (isPending) return { isPending: true, allowed: false };
  if (!session) return { isPending: false, allowed: false };
  const role = (session.user as { role?: string | null }).role ?? null;
  return { isPending: false, allowed: checkPermission(role, resource, action) };
}

/**
 * Like {@link useHasPermission}, but ignores the team-scoped roles
 * (`official`, `junior_manager`). Mirror of the backend's
 * requireClubWidePermission preHandler - use it for actions the API gates
 * club-wide so the UI never offers a control that 403s.
 */
export function useHasClubWidePermission<R extends Resource>(
  resource: R,
  action: Action<R>,
): { isPending: boolean; allowed: boolean } {
  const { data: session, isPending } = useSession();
  if (isPending) return { isPending: true, allowed: false };
  if (!session) return { isPending: false, allowed: false };
  const role = (session.user as { role?: string | null }).role ?? null;
  return {
    isPending: false,
    allowed: hasClubWideAccess(role, resource, action),
  };
}

/**
 * True iff the current user has any non-default role. Kept for places that
 * genuinely just need "is this an elevated user" — but for "show the Admin
 * Panel link" use {@link useHasAdminPanelAccess}, since AI-only roles count
 * as elevated but don't see anything in /admin.
 */
export function useHasAnyElevatedRole(): boolean {
  const { data: session } = useSession();
  if (!session) return false;
  const role = (session.user as { role?: string | null }).role ?? null;
  return hasAnyElevatedRole(role);
}

/**
 * True iff the current user has at least one admin-panel sub-tab unlocked.
 * Used to gate the "Admin Panel" links and the /admin route — replaces
 * useHasAnyElevatedRole at those callsites so AI-only roles (which are
 * "elevated" but have zero admin-panel surface) don't see a dead link.
 */
export function useHasAdminPanelAccess(): boolean {
  const { data: session } = useSession();
  if (!session) return false;
  const role = (session.user as { role?: string | null }).role ?? null;
  return hasAdminPanelAccess(role);
}
