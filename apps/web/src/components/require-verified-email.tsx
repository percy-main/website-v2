import { Navigate, Outlet } from "react-router";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

export function RequireVerifiedEmail() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <PageLoading />;
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />;
  }

  if (!session.user.emailVerified) {
    return <Navigate to="/auth/registered" replace />;
  }

  return <Outlet />;
}
