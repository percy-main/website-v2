import { format } from "date-fns";
import { Navigate } from "react-router";

export function Component() {
  const now = new Date();
  const year = format(now, "yyyy");
  const month = format(now, "MMMM").toLowerCase();

  return <Navigate to={`/calendar/${year}/${month}`} replace />;
}
