import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];

function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard", "be-the-keeper"],
    queryFn: () =>
      callApi(
        api.GET("/api/leaderboard", {
          params: { query: { game: "be-the-keeper", limit: 25 } },
        }),
      ),
  });
}

export function Component() {
  useDocumentMeta(
    "Be The Keeper: Leaderboard",
    "Top scorers in Percy Main's Be The Keeper cricket game.",
  );
  const query = useLeaderboard();
  const entries = query.data;

  return (
    <div className="mx-auto max-w-3xl py-8">
      <nav className="mb-6 text-sm">
        <Link
          to="/game/be-the-keeper"
          className="text-green-800 hover:underline"
        >
          &larr; Back to game
        </Link>
      </nav>

      <h1
        className="mb-2 text-3xl font-semibold"
        style={{ fontFamily: "var(--font-secondary), serif" }}
      >
        Be The Keeper: Leaderboard
      </h1>
      <p className="mb-8 text-stone-600">Top 25 keepers at Percy Main CC</p>

      {query.isLoading && (
        <p className="py-12 text-center text-stone-400">Loading scores…</p>
      )}

      {!query.isLoading && (!entries || entries.length === 0) && (
        <p className="rounded-lg bg-stone-50 p-8 text-center text-stone-500">
          No scores yet.{" "}
          <Link to="/game/be-the-keeper" className="text-green-800 underline">
            Be the first!
          </Link>
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Be the Keeper leaderboard</caption>
            <thead>
              <tr className="bg-[#1B3D2F] text-white">
                <th scope="col" className="px-4 py-3 font-semibold">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Score
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-semibold sm:table-cell"
                >
                  Level
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-semibold sm:table-cell"
                >
                  Catches
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-semibold md:table-cell"
                >
                  Best Streak
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, rank) => (
                <tr
                  key={`${rank}-${row.name ?? "unknown"}-${row.score}`}
                  className={`border-t border-stone-100 ${rank % 2 === 0 ? "bg-white" : "bg-stone-50"} ${rank < 3 ? "font-semibold" : ""}`}
                >
                  <td className="px-4 py-3">{medals[rank] ?? rank + 1}</td>
                  <td className="px-4 py-3">{row.name ?? "Unknown"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.score}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {row.level}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {row.catches}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {row.bestStreak}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
