import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

export function RequireAuth() {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return <PageLoading />;
  }

  if (!session) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
