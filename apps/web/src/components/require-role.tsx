import { Navigate, Outlet } from "react-router";
import { useSession } from "../lib/auth-client.js";

export function RequireRole({ roles }: { roles: string[] }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return null;
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />;
  }

  const userRole = (session.user as { role?: string | null }).role ?? "user";
  if (!roles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
