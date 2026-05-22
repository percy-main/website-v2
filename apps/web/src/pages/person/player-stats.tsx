import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

type CareerStats = NonNullable<
  paths["/api/play-cricket/player-career-stats"]["get"]["responses"]["200"]["content"]["application/json"]
>;
type FormatStats = CareerStats["formats"][number];

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-center">
      <div className="text-lg font-bold text-green-800">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}

function FormatSection({
  format,
  showHeading,
}: {
  format: FormatStats;
  showHeading: boolean;
}) {
  const { career, battingSeasons, bowlingSeasons } = format;
  const bestBowling = career.bowling.bestBowling
    ? `${career.bowling.bestBowling.wickets}/${career.bowling.bestBowling.runs}`
    : null;

  return (
    <section className="mb-8 last:mb-0">
      {showHeading && (
        <h3 className="mb-3 text-base font-semibold text-stone-700">
          {format.label}
        </h3>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatCard label="Matches" value={String(career.batting.matches)} />
        <StatCard label="Total Runs" value={String(career.batting.runs)} />
        <StatCard
          label="Total Wickets"
          value={String(career.bowling.wickets)}
        />
        {career.batting.highScore > 0 && (
          <StatCard
            label="High Score"
            value={String(career.batting.highScore)}
          />
        )}
        {bestBowling !== null && (
          <StatCard label="Best Bowling" value={bestBowling} />
        )}
      </div>

      {battingSeasons.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-stone-500">Batting</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">Inn</TableHead>
                  <TableHead className="text-right">NO</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">HS</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    SR
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    4s
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    6s
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    50s
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    100s
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {battingSeasons.map((s) => (
                  <TableRow key={s.season}>
                    <TableCell className="font-medium">{s.season}</TableCell>
                    <TableCell className="text-right">{s.innings}</TableCell>
                    <TableCell className="text-right">{s.notOuts}</TableCell>
                    <TableCell className="text-right font-bold">
                      {s.runs}
                    </TableCell>
                    <TableCell className="text-right">{s.highScore}</TableCell>
                    <TableCell className="text-right">
                      {s.average ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.strikeRate ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.fours}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.sixes}
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell">
                      {s.fifties}
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell">
                      {s.hundreds}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {bowlingSeasons.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-stone-500">Bowling</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">O</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    M
                  </TableHead>
                  <TableHead className="text-right">R</TableHead>
                  <TableHead className="text-right">W</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Econ
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    SR
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Best
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bowlingSeasons.map((s) => (
                  <TableRow key={s.season}>
                    <TableCell className="font-medium">{s.season}</TableCell>
                    <TableCell className="text-right">{s.overs}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.maidens}
                    </TableCell>
                    <TableCell className="text-right">{s.runs}</TableCell>
                    <TableCell className="text-right font-bold">
                      {s.wickets}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.average ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.economy ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {s.strikeRate ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell">
                      {s.bestBowling ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlayerStats({ slug }: { slug: string }) {
  const careerQuery = useQuery({
    queryKey: ["player-career-stats", slug],
    queryFn: () =>
      callApi(
        api.GET("/api/play-cricket/player-career-stats", {
          params: { query: { slug } },
        }),
      ),
    staleTime: 5 * 60 * 1000,
  });

  if (careerQuery.isPending) {
    return (
      <div className="mt-6 space-y-3">
        <div className="h-6 w-32 animate-pulse rounded bg-stone-200" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {["s1", "s2", "s3", "s4", "s5"].map((k) => (
            <div
              key={k}
              className="h-16 animate-pulse rounded-lg bg-stone-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!careerQuery.data || careerQuery.data.formats.length === 0) {
    return null;
  }

  const { formats } = careerQuery.data;
  // Only label sections when there is more than one — players with a single
  // format see the same headline-stats-and-tables view they always have.
  const showHeadings = formats.length > 1;
  const hardballSeasons =
    formats.find((f) => f.gameType === "Standard")?.battingSeasons ?? [];

  return (
    <div className="mt-6">
      <h2 className="mb-4 text-lg font-semibold">Statistics</h2>

      {formats.map((format) => (
        <FormatSection
          key={format.gameType}
          format={format}
          showHeading={showHeadings}
        />
      ))}

      {hardballSeasons.length > 0 && (
        <p className="mt-4 text-xs text-stone-400">
          View the full{" "}
          <Link
            to={`/cricket/records/leaderboards?season=${hardballSeasons[0].season}`}
            className="text-green-800 underline decoration-green-800/30 underline-offset-2 hover:decoration-green-800"
          >
            {hardballSeasons[0].season} season leaderboard
          </Link>
        </p>
      )}
    </div>
  );
}
