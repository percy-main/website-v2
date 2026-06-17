import { Kicker } from "@/components/theme/bits.js";
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
    <div className="border-primary bg-surface border-2 px-3 py-2 text-center">
      <div className="text-primary text-lg font-bold">{value}</div>
      <div className="text-muted text-xs">{label}</div>
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
        <Kicker level={3} className="mb-3">
          {format.label}
        </Kicker>
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
          <Kicker className="mb-1">Batting</Kicker>
          <div className="fc-stat overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Batting statistics by season
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Season</TableHead>
                  <TableHead scope="col" className="text-right">
                    Inn
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    NO
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Runs
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    HS
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Avg
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    SR
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    4s
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    6s
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right md:table-cell"
                  >
                    50s
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right md:table-cell"
                  >
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
          <Kicker className="mb-1">Bowling</Kicker>
          <div className="fc-stat overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Bowling statistics by season
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Season</TableHead>
                  <TableHead scope="col" className="text-right">
                    O
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    M
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    R
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    W
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Avg
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    Econ
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right sm:table-cell"
                  >
                    SR
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="hidden text-right md:table-cell"
                  >
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
  const { data: careerData, isPending: careerPending } = useQuery({
    queryKey: ["player-career-stats", slug],
    queryFn: () =>
      callApi(
        api.GET("/api/play-cricket/player-career-stats", {
          params: { query: { slug } },
        }),
      ),
    staleTime: 5 * 60 * 1000,
  });

  if (careerPending) {
    return (
      <div className="mt-6 space-y-3">
        <div className="bg-primary/10 h-6 w-32 animate-pulse rounded" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {["s1", "s2", "s3", "s4", "s5"].map((k) => (
            <div key={k} className="bg-primary/10 h-16 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!careerData || careerData.formats.length === 0) {
    return null;
  }

  const { formats } = careerData;
  // Only label sections when there is more than one — players with a single
  // format see the same headline-stats-and-tables view they always have.
  const showHeadings = formats.length > 1;
  const hardballSeasons =
    formats.find((f) => f.gameType === "Standard")?.battingSeasons ?? [];

  return (
    <div className="mt-6">
      <h2 className="fc-two-tone mb-4 text-lg font-semibold">Statistics</h2>

      {formats.map((format) => (
        <FormatSection
          key={format.gameType}
          format={format}
          showHeading={showHeadings}
        />
      ))}

      {hardballSeasons.length > 0 && (
        <p className="text-muted mt-4 text-xs">
          View the full{" "}
          <Link
            to={`/cricket/records/leaderboards?season=${hardballSeasons[0].season}`}
            className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
          >
            {hardballSeasons[0].season} season leaderboard
          </Link>
        </p>
      )}
    </div>
  );
}
