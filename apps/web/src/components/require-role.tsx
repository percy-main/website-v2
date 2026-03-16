import { Navigate, Outlet } from "react-router";
import { useSession } from "../lib/auth-client.js";

function getUserRole(user: Record<string, unknown>): string {
  return typeof user.role === "string" ? user.role : "user";
}

export function RequireRole({ roles }: { roles: string[] }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return null;
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />;
  }

  const userRole = getUserRole(session.user);
  if (!roles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
