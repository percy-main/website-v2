import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { z } from "zod";

const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];

const leaderboardSchema = z.array(
  z.object({
    name: z.string().nullable(),
    score: z.number(),
    level: z.number(),
    catches: z.number(),
    bestStreak: z.number(),
  }),
);

function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard", "be-the-keeper"],
    queryFn: async () =>
      leaderboardSchema.parse(
        await api.get("/leaderboard?game=be-the-keeper&limit=25"),
      ),
  });
}

export function Component() {
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
        className="mb-2 text-3xl font-bold"
        style={{ fontFamily: "var(--font-secondary), serif" }}
      >
        Be The Keeper — Leaderboard
      </h1>
      <p className="mb-8 text-gray-600">Top 25 keepers at Percy Main CC</p>

      {query.isLoading && (
        <p className="py-12 text-center text-gray-400">Loading scores...</p>
      )}

      {!query.isLoading && (!entries || entries.length === 0) && (
        <p className="rounded-lg bg-gray-50 p-8 text-center text-gray-500">
          No scores yet.{" "}
          <Link to="/game/be-the-keeper" className="text-green-800 underline">
            Be the first!
          </Link>
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#1B3D2F] text-white">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 text-right font-semibold">Score</th>
                <th className="hidden px-4 py-3 text-right font-semibold sm:table-cell">
                  Level
                </th>
                <th className="hidden px-4 py-3 text-right font-semibold sm:table-cell">
                  Catches
                </th>
                <th className="hidden px-4 py-3 text-right font-semibold md:table-cell">
                  Best Streak
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, i) => (
                <tr
                  key={i}
                  className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"} ${i < 3 ? "font-semibold" : ""}`}
                >
                  <td className="px-4 py-3">{medals[i] ?? i + 1}</td>
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
