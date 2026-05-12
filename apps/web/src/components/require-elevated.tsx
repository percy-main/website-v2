import { hasAnyElevatedRole } from "@percy-main/shared/auth/permissions";
import { Navigate, Outlet } from "react-router";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

/**
 * Gates a route to any user with a non-default role. Used at the admin-portal
 * root; individual tabs/routes inside then check their own RequirePermission.
 */
export function RequireElevated() {
  const { data: session, isPending } = useSession();

  if (isPending) return <PageLoading />;
  if (!session) return <Navigate to="/auth/login" replace />;

  const role = (session.user as { role?: string | null }).role ?? null;
  if (!hasAnyElevatedRole(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
