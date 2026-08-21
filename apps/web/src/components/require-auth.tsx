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
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/login?returnTo=${returnTo}`} replace />;
  }

  // Keying the whole authenticated subtree on the user id forces a remount
  // when the signed-in account changes, so component-local state cannot
  // straddle two identities (#628). Clearing the query cache is not enough
  // on its own: state seeded from query data on mount (TeamBuilder's squad,
  // for one) keeps the previous user's values until the component unmounts.
  return <Outlet key={session.user.id} />;
}
