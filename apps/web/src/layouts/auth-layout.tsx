import { Outlet } from "react-router";

export function AuthLayout() {
  return (
    <div className="bg-creamy flex flex-col items-center px-4 py-12">
      <Outlet />
    </div>
  );
}
