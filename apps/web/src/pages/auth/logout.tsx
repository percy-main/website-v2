import { authClient } from "@/lib/auth-client.js";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export function Component() {
  const navigate = useNavigate();

  useEffect(() => {
    void authClient.signOut().then(() => {
      void navigate("/");
    });
  }, [navigate]);

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="p-6 text-center sm:p-8">
        <p className="text-gray-600">Logging out...</p>
      </div>
    </div>
  );
}
