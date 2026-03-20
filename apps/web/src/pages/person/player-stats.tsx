import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

interface CareerStatsResponse {
  playCricketId: string;
  seasons: number[];
  career: {
    batting: {
      matches: number;
      runs: number;
      highScore: number;
      notOuts: number;
    };
    bowling: {
      innings: number;
      overs: number;
      maidens: number;
      runsConceded: number;
      wickets: number;
      bestBowling: { wickets: number; runs: number } | null;
    };
  };
}

interface SeasonStatsResponse {
  playCricketId: string;
  season: number;
  batting: {
    innings: number;
    runs: number;
    notOuts: number;
    average: number | null;
    highScore: number;
    strikeRate: number | null;
    fours: number;
    sixes: number;
    fifties: number;
    hundreds: number;
  };
  bowling: {
    innings: number;
    overs: string;
    maidens: number;
    wickets: number;
    runs: number;
    average: number | null;
    economy: number | null;
    strikeRate: number | null;
    bestBowling: string | null;
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
      <div className="text-lg font-bold text-green-800">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

export function PlayerStats({ slug }: { slug: string }) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const careerQuery = useQuery({
    queryKey: ["player-career-stats", slug],
    queryFn: () =>
      api.get<CareerStatsResponse>(
        `/play-cricket/player-career-stats?slug=${slug}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  const effectiveSeason =
    selectedSeason ?? careerQuery.data?.seasons[0] ?? null;

  const seasonQuery = useQuery({
    queryKey: ["player-season-stats", slug, effectiveSeason],
    queryFn: () =>
      api.get<SeasonStatsResponse>(
        `/play-cricket/player-season-stats?slug=${slug}&season=${effectiveSeason}`,
      ),
    enabled: effectiveSeason !== null,
    staleTime: 5 * 60 * 1000,
  });

  if (careerQuery.isPending) {
    return (
      <div className="mt-6 space-y-3">
        <div className="h-6 w-32 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!careerQuery.data) {
    return null;
  }

  const { career, seasons } = careerQuery.data;

  if (seasons.length === 0) {
    return null;
  }

  const bestBowling = career.bowling.bestBowling
    ? `${career.bowling.bestBowling.wickets}/${career.bowling.bestBowling.runs}`
    : null;

  const season = seasonQuery.data;

  return (
    <div className="mt-6">
      <h2 className="mb-4 text-lg font-semibold">Statistics</h2>

      {/* Career headline stats */}
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

      {/* Season selector */}
      {seasons.length > 0 && (
        <div className="mt-6 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-600">Season Stats</h3>
          <Select
            value={String(effectiveSeason)}
            onValueChange={(v) => setSelectedSeason(Number(v))}
          >
            <SelectTrigger className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Season stats loading */}
      {seasonQuery.isPending && (
        <div className="mt-4 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      )}

      {/* Season stats tables */}
      {season && (
        <div className="mt-4 space-y-4">
          {/* Batting summary table */}
          {season.batting.innings > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Batting</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Inn</TableHead>
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
                    <TableRow>
                      <TableCell>{season.batting.innings}</TableCell>
                      <TableCell className="text-right">
                        {season.batting.notOuts}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {season.batting.runs}
                      </TableCell>
                      <TableCell className="text-right">
                        {season.batting.highScore}
                      </TableCell>
                      <TableCell className="text-right">
                        {season.batting.average?.toFixed(2) ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.batting.strikeRate?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.batting.fours}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.batting.sixes}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {season.batting.fifties}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {season.batting.hundreds}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Bowling summary table */}
          {season.bowling.innings > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Bowling</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>O</TableHead>
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
                    <TableRow>
                      <TableCell>{season.bowling.overs}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.bowling.maidens}
                      </TableCell>
                      <TableCell className="text-right">
                        {season.bowling.runs}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {season.bowling.wickets}
                      </TableCell>
                      <TableCell className="text-right">
                        {season.bowling.average?.toFixed(2) ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.bowling.economy?.toFixed(2) ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {season.bowling.strikeRate?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {season.bowling.bestBowling ?? "-"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {season.batting.innings === 0 && season.bowling.innings === 0 && (
            <p className="text-sm text-gray-500">
              No statistics available for this season.
            </p>
          )}

          {/* Leaderboard link */}
          <p className="text-xs text-gray-400">
            View the full{" "}
            <Link
              to={`/leaderboard/${effectiveSeason}`}
              className="text-green-800 underline decoration-green-800/30 underline-offset-2 hover:decoration-green-800"
            >
              {effectiveSeason} season leaderboard
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
