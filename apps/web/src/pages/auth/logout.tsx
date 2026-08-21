import { authClient } from "@/lib/auth-client.js";
import { resetAuthCaches } from "@/lib/query-client.js";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    void authClient
      .signOut()
      .catch(() => {
        // Sign out failed (network error, etc.) - navigate home regardless
      })
      .then(async () => {
        // Wipe every cached query before leaving this page, on the failure
        // path too: the user asked to log out, so none of their data should
        // survive in memory for whoever signs in next (#628).
        await resetAuthCaches(queryClient);
        void navigate("/");
      });
  }, [navigate, queryClient]);

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="p-6 text-center sm:p-8">
        <p className="text-stone-600">Logging out…</p>
      </div>
    </div>
  );
}
