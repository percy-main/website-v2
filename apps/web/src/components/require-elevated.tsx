import { hasAdminPanelAccess } from "@percy-main/shared/auth/permissions";
import { Navigate, Outlet } from "react-router";
import { useSession } from "../lib/auth-client.js";
import { PageLoading } from "./page-loading.js";

/**
 * Gates the /admin route to users who have at least one admin-panel sub-tab
 * unlocked. AI-only roles (ai_chat_user, ai_facts_viewer, etc.) are
 * intentionally redirected because the admin panel would be empty for them —
 * Scout has its own dedicated page.
 */
export function RequireElevated() {
  const { data: session, isPending } = useSession();

  if (isPending) return <PageLoading />;
  if (!session) return <Navigate to="/auth/login" replace />;

  const role = (session.user as { role?: string | null }).role ?? null;
  if (!hasAdminPanelAccess(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
