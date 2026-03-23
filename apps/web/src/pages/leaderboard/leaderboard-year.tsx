import { LeaderboardContent } from "@/components/leaderboard-content.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { Navigate, useParams, useSearchParams } from "react-router";

function LeaderboardPage() {
  const [searchParams] = useSearchParams();

  const seasonParam = searchParams.get("season");
  const title =
    seasonParam && seasonParam !== "all"
      ? `${seasonParam} Season Leaderboard`
      : "All Time Leaderboard";

  useDocumentMeta(title);

  return (
    <div className="container mx-auto px-4 py-8">
      <LeaderboardContent />
    </div>
  );
}

export function Component() {
  const { year } = useParams();

  // Redirect /leaderboard/:year to /leaderboard?season=:year for backwards compat
  if (year) {
    return <Navigate to={`/leaderboard?season=${year}`} replace />;
  }

  return <LeaderboardPage />;
}
