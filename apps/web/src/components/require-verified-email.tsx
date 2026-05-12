import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

export function RequireVerifiedEmail() {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return <PageLoading />;
  }

  // Preserve the originally-requested destination across the bounce so
  // a deep link survives the registered → login → verified-email flow.
  const returnTo = encodeURIComponent(location.pathname + location.search);

  if (!session) {
    return <Navigate to={`/auth/login?returnTo=${returnTo}`} replace />;
  }

  if (!session.user.emailVerified) {
    return <Navigate to={`/auth/registered?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}
