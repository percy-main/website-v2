import {
  checkPermission,
  hasAnyElevatedRole,
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
 * True iff the current user has any non-default role. Used to gate the
 * "Admin Panel" links scattered across the members/matchday/etc. pages.
 */
export function useHasAnyElevatedRole(): boolean {
  const { data: session } = useSession();
  if (!session) return false;
  const role = (session.user as { role?: string | null }).role ?? null;
  return hasAnyElevatedRole(role);
}
