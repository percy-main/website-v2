import type { Action, Resource } from "@percy-main/shared/auth/permissions";
import { Navigate, Outlet } from "react-router";
import { useHasPermission } from "../hooks/use-has-permission.js";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

export function RequirePermission<R extends Resource>({
  resource,
  action,
}: {
  resource: R;
  action: Action<R>;
}) {
  const { data: session, isPending } = useSession();
  const { allowed } = useHasPermission(resource, action);

  if (isPending) return <PageLoading />;
  if (!session) return <Navigate to="/auth/login" replace />;
  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}
