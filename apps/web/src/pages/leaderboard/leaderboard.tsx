import { Navigate } from "react-router";

/** Returns the current cricket season year (seasons run April–September). */
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  // If before April, the most recent season was the previous year
  return month < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

export function Component() {
  return <Navigate to={`/leaderboard/${getCurrentSeason()}`} replace />;
}
