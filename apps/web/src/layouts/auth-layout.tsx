import { Logo } from "@/components/logo.js";
import { Outlet } from "react-router";

export function AuthLayout() {
  return (
    <div className="bg-creamy flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-6">
        <Logo size="lg" />
      </div>
      <Outlet />
    </div>
  );
}
