import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

function currentCricketSeason(): number {
  const now = new Date();
  // Cricket season runs April-September; Jan-Mar use previous year
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

function fetchBatting(season: number, limit: number) {
  return callApi(
    api.GET("/api/cricket-leaderboard/batting", {
      params: { query: { season, limit } },
    }),
  );
}

function fetchBowling(season: number, limit: number) {
  return callApi(
    api.GET("/api/cricket-leaderboard/bowling", {
      params: { query: { season, limit } },
    }),
  );
}

function PlayerLink({
  name,
  slug,
}: {
  name: string | null;
  slug: string | null;
}) {
  if (slug) {
    return (
      <Link
        to={`/person/${slug}`}
        className="font-medium text-green-800 underline decoration-green-800/30 underline-offset-2 hover:decoration-green-800"
      >
        {name}
      </Link>
    );
  }
  return <span className="font-medium">{name}</span>;
}

function MiniTable({
  title,
  caption,
  children,
  headers,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
  headers: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-3 text-sm font-semibold tracking-wide text-stone-600 uppercase">
        {title}
      </h4>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>{headers}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

export function SeasonLeaders() {
  const season = currentCricketSeason();

  // Decide the display season once, then fetch both tables for that same season.
  // Try current season first; if batting has no data, fall back to previous for both.
  const seasonQuery = useQuery({
    queryKey: ["season-leaders", season],
    queryFn: async () => {
      const [batting, bowling] = await Promise.all([
        fetchBatting(season, 3),
        fetchBowling(season, 3),
      ]);

      if (batting.entries.length > 0 || bowling.entries.length > 0) {
        return { batting, bowling, effectiveSeason: season };
      }

      // Fall back to previous season for both
      const prev = season - 1;
      const [battingFb, bowlingFb] = await Promise.all([
        fetchBatting(prev, 3),
        fetchBowling(prev, 3),
      ]);

      return {
        batting: battingFb,
        bowling: bowlingFb,
        effectiveSeason: prev,
      };
    },
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = seasonQuery.isLoading;
  if (seasonQuery.error) return null;

  const battingEntries = seasonQuery.data?.batting?.entries ?? [];
  const bowlingEntries = seasonQuery.data?.bowling?.entries ?? [];
  const effectiveSeason = seasonQuery.data?.effectiveSeason ?? season;

  if (!isLoading && battingEntries.length === 0 && bowlingEntries.length === 0)
    return null;

  return (
    <div>
      <h3
        className="font-secondary mb-6 text-center font-semibold"
        style={{ fontSize: "var(--text-h4)" }}
      >
        Season Leaders
      </h3>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {["batting", "bowling"].map((col) => (
            <div key={col} className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-stone-200" />
              {["row1", "row2", "row3"].map((row) => (
                <div
                  key={`${col}-${row}`}
                  className="h-8 animate-pulse rounded bg-stone-100"
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {battingEntries.length > 0 && (
            <MiniTable
              title="Top Run Scorers"
              caption="Top run scorers"
              headers={
                <>
                  <TableHead scope="col" className="w-8">
                    #
                  </TableHead>
                  <TableHead scope="col">Player</TableHead>
                  <TableHead scope="col" className="text-right">
                    Runs
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    HS
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    Avg
                  </TableHead>
                </>
              }
            >
              {battingEntries.map((entry, idx) => (
                <TableRow
                  key={entry.slug ?? `${entry.playerName ?? "unknown"}-${idx}`}
                >
                  <TableCell className="text-stone-400">{idx + 1}</TableCell>
                  <TableCell>
                    <PlayerLink name={entry.playerName} slug={entry.slug} />
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {entry.runs}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {entry.highScore}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {entry.average?.toFixed(2) ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </MiniTable>
          )}

          {bowlingEntries.length > 0 && (
            <MiniTable
              title="Top Wicket Takers"
              caption="Top wicket takers"
              headers={
                <>
                  <TableHead scope="col" className="w-8">
                    #
                  </TableHead>
                  <TableHead scope="col">Player</TableHead>
                  <TableHead scope="col" className="text-right">
                    Wkts
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    Overs
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    Avg
                  </TableHead>
                </>
              }
            >
              {bowlingEntries.map((entry, idx) => (
                <TableRow
                  key={entry.slug ?? `${entry.playerName ?? "unknown"}-${idx}`}
                >
                  <TableCell className="text-stone-400">{idx + 1}</TableCell>
                  <TableCell>
                    <PlayerLink name={entry.playerName} slug={entry.slug} />
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {entry.wickets}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {entry.overs}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {entry.average?.toFixed(2) ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </MiniTable>
          )}
        </div>
      )}

      <div className="mt-4 text-center">
        <Link
          to={`/cricket/records/leaderboards?season=${effectiveSeason}`}
          className="text-primary hover:text-primary-light text-sm font-medium transition"
        >
          View full {effectiveSeason} leaderboard &rarr;
        </Link>
      </div>
    </div>
  );
}
