import { Outlet } from "react-router";
import { Logo } from "@/components/logo.js";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-creamy px-4">
      <div className="mb-6">
        <Logo size="lg" />
      </div>
      <Outlet />
    </div>
  );
}
