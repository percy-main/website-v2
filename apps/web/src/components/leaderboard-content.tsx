import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js";
import { api } from "@/lib/api.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

const FIRST_SEASON = 2012;
const COMPETITION_TYPES = ["League", "Cup", "Friendly"] as const;

interface BattingEntry {
  playerId: string;
  playerName: string;
  slug: string | null;
  innings: number;
  notOuts: number;
  runs: number;
  highScore: number;
  average: number | null;
  strikeRate: number | null;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
}

interface BowlingEntry {
  playerId: string;
  playerName: string;
  slug: string | null;
  matches: number;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  average: number | null;
  economy: number | null;
  strikeRate: number | null;
  bestBowling: string;
}

interface SponsorEntry {
  slug: string;
  display_name: string | null;
  sponsor_name: string;
  sponsor_website: string | null;
}

interface Team {
  id: string;
  name: string;
  is_junior: boolean;
}

function buildQueryString(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  return qs.toString();
}

function useTeams() {
  return useQuery({
    queryKey: ["play-cricket-teams"],
    queryFn: () => api.get<{ teams: Team[] }>("/play-cricket/teams"),
    staleTime: 30 * 60 * 1000,
  });
}

function useSponsors(season: number | null) {
  const qs = season !== null ? `?season=${season}` : "";
  return useQuery({
    queryKey: ["player-sponsors", season],
    queryFn: () =>
      api.get<{ sponsors: SponsorEntry[] }>(
        `/sponsorship/player/approved${qs}`,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

function useBattingLeaderboard(
  season: number | null,
  isJunior: boolean,
  teamId: string,
  competitionTypes: string[],
) {
  const qs = buildQueryString({
    season: season !== null ? String(season) : undefined,
    isJunior: String(isJunior),
    teamId: teamId || undefined,
    competitionTypes:
      competitionTypes.length > 0 ? competitionTypes.join(",") : undefined,
  });

  return useQuery({
    queryKey: [
      "batting-leaderboard",
      season,
      isJunior,
      teamId,
      competitionTypes,
    ],
    queryFn: () =>
      api.get<{ entries: BattingEntry[] }>(
        `/cricket-leaderboard/batting?${qs}`,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

function useBowlingLeaderboard(
  season: number | null,
  isJunior: boolean,
  teamId: string,
  competitionTypes: string[],
) {
  const qs = buildQueryString({
    season: season !== null ? String(season) : undefined,
    isJunior: String(isJunior),
    teamId: teamId || undefined,
    competitionTypes:
      competitionTypes.length > 0 ? competitionTypes.join(",") : undefined,
  });

  return useQuery({
    queryKey: [
      "bowling-leaderboard",
      season,
      isJunior,
      teamId,
      competitionTypes,
    ],
    queryFn: () =>
      api.get<{ entries: BowlingEntry[] }>(
        `/cricket-leaderboard/bowling?${qs}`,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

function getSeasonRange(): number[] {
  const now = new Date();
  const currentYear =
    now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= FIRST_SEASON; y--) {
    years.push(y);
  }
  return years;
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div className="h-4 w-12 animate-pulse rounded bg-gray-200" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function PlayerName({
  name,
  slug,
  sponsors,
}: {
  name: string;
  slug: string | null;
  sponsors: Map<string, SponsorEntry>;
}) {
  const sponsor = slug ? sponsors.get(slug) : undefined;

  const nameElement = slug ? (
    <Link
      to={`/person/${slug}`}
      className="font-medium text-green-800 underline decoration-green-800/30 underline-offset-2 hover:decoration-green-800"
    >
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );

  return (
    <div>
      {nameElement}
      {sponsor && (
        <span className="block text-xs text-gray-500">
          {sponsor.display_name ?? sponsor.sponsor_name}
        </span>
      )}
    </div>
  );
}

function BattingTable({
  entries,
  isPending,
  error,
  sponsors,
}: {
  entries: BattingEntry[] | undefined;
  isPending: boolean;
  error: Error | null;
  sponsors: Map<string, SponsorEntry>;
}) {
  if (error) {
    return (
      <p className="py-4 text-center text-red-600">
        Failed to load batting leaderboard.
      </p>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Inn</TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              NO
            </TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">HS</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              SR
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              4s
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              6s
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              50s
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              100s
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending && <SkeletonRows cols={12} />}
          {entries?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={12}
                className="py-8 text-center text-gray-500"
              >
                No batting data available yet.
              </TableCell>
            </TableRow>
          )}
          {entries?.map((e, i) => (
            <TableRow key={e.playerId}>
              <TableCell className="text-gray-500">{i + 1}</TableCell>
              <TableCell>
                <PlayerName
                  name={e.playerName}
                  slug={e.slug}
                  sponsors={sponsors}
                />
              </TableCell>
              <TableCell className="text-right">{e.innings}</TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                {e.notOuts}
              </TableCell>
              <TableCell className="text-right font-medium">{e.runs}</TableCell>
              <TableCell className="text-right">{e.highScore}</TableCell>
              <TableCell className="text-right">
                {e.average?.toFixed(2) ?? "-"}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {e.strikeRate?.toFixed(1) ?? "-"}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {e.fours}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {e.sixes}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                {e.fifties}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                {e.hundreds}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries && entries.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Averages shown for players with 3+ innings.
        </p>
      )}
    </div>
  );
}

function BowlingTable({
  entries,
  isPending,
  error,
  sponsors,
}: {
  entries: BowlingEntry[] | undefined;
  isPending: boolean;
  error: Error | null;
  sponsors: Map<string, SponsorEntry>;
}) {
  if (error) {
    return (
      <p className="py-4 text-center text-red-600">
        Failed to load bowling leaderboard.
      </p>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">O</TableHead>
            <TableHead className="hidden text-right sm:table-cell">M</TableHead>
            <TableHead className="text-right">R</TableHead>
            <TableHead className="text-right">W</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Econ
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              SR
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              Best
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending && <SkeletonRows cols={10} />}
          {entries?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={10}
                className="py-8 text-center text-gray-500"
              >
                No bowling data available yet.
              </TableCell>
            </TableRow>
          )}
          {entries?.map((e, i) => (
            <TableRow key={e.playerId}>
              <TableCell className="text-gray-500">{i + 1}</TableCell>
              <TableCell>
                <PlayerName
                  name={e.playerName}
                  slug={e.slug}
                  sponsors={sponsors}
                />
              </TableCell>
              <TableCell className="text-right">{e.overs}</TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                {e.maidens}
              </TableCell>
              <TableCell className="text-right">{e.runs}</TableCell>
              <TableCell className="text-right font-medium">
                {e.wickets}
              </TableCell>
              <TableCell className="text-right">
                {e.average?.toFixed(2) ?? "-"}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {e.economy?.toFixed(2) ?? "-"}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {e.strikeRate?.toFixed(1) ?? "-"}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                {e.bestBowling}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries && entries.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Averages and strike rates shown for bowlers with 10+ overs.
        </p>
      )}
    </div>
  );
}

/**
 * Self-contained leaderboard component that manages all state via URL search params.
 * Can be used standalone or embedded in MDX pages.
 */
export function LeaderboardContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const seasons = getSeasonRange();

  const seasonParam = searchParams.get("season");
  const season: number | null =
    seasonParam === null || seasonParam === "all" ? null : Number(seasonParam);

  const [isJunior, setIsJunior] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [competitionTypes, setCompetitionTypes] = useState<string[]>([]);
  const [discipline, setDiscipline] = useState<"batting" | "bowling">(
    "batting",
  );

  const teamsQuery = useTeams();
  const sponsorsQuery = useSponsors(season);

  const battingQuery = useBattingLeaderboard(
    season,
    isJunior,
    teamId,
    competitionTypes,
  );
  const bowlingQuery = useBowlingLeaderboard(
    season,
    isJunior,
    teamId,
    competitionTypes,
  );

  const teams = teamsQuery.data?.teams ?? [];
  const filteredTeams = teams.filter((t) => t.is_junior === isJunior);

  const sponsorMap = new Map<string, SponsorEntry>();
  for (const s of sponsorsQuery.data?.sponsors ?? []) {
    sponsorMap.set(s.slug, s);
  }

  const handleCategoryChange = (junior: boolean) => {
    setIsJunior(junior);
    setTeamId("");
  };

  const toggleCompetitionType = (type: string) => {
    setCompetitionTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleSeasonChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "all") {
          next.delete("season");
        } else {
          next.set("season", value);
        }
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">
          {season !== null ? `${season} Season` : "All Time"} Leaderboard
        </h2>
        <select
          value={season !== null ? String(season) : "all"}
          onChange={(e) => handleSeasonChange(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All Time</option>
          {seasons.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Category toggle */}
        <div className="inline-flex rounded-md bg-gray-100 p-1">
          <button
            className={`rounded px-3 py-1 text-sm font-medium ${
              !isJunior ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
            onClick={() => handleCategoryChange(false)}
          >
            Seniors
          </button>
          <button
            className={`rounded px-3 py-1 text-sm font-medium ${
              isJunior ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
            onClick={() => handleCategoryChange(true)}
          >
            Juniors
          </button>
        </div>

        {/* Team filter */}
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All teams</option>
          {filteredTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Competition type checkboxes */}
        <div className="flex items-center gap-3">
          {COMPETITION_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={competitionTypes.includes(type)}
                onChange={() => toggleCompetitionType(type)}
                className="rounded border-gray-300"
              />
              {type}
            </label>
          ))}
        </div>
      </div>

      {/* Discipline tabs */}
      <Tabs
        value={discipline}
        onValueChange={(v) => setDiscipline(v as "batting" | "bowling")}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="batting">Batting</TabsTrigger>
          <TabsTrigger value="bowling">Bowling</TabsTrigger>
        </TabsList>
        <TabsContent value="batting">
          <BattingTable
            entries={battingQuery.data?.entries}
            isPending={battingQuery.isPending}
            error={battingQuery.error}
            sponsors={sponsorMap}
          />
        </TabsContent>
        <TabsContent value="bowling">
          <BowlingTable
            entries={bowlingQuery.data?.entries}
            isPending={bowlingQuery.isPending}
            error={bowlingQuery.error}
            sponsors={sponsorMap}
          />
        </TabsContent>
      </Tabs>

      {/* Season navigation */}
      <div className="mt-8 flex justify-center gap-2">
        {season !== null && season > FIRST_SEASON && (
          <button
            onClick={() => handleSeasonChange(String(season - 1))}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {season - 1}
          </button>
        )}
        {season !== null && season < seasons[0] && (
          <button
            onClick={() => handleSeasonChange(String(season + 1))}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {season + 1}
          </button>
        )}
        {season !== null && (
          <button
            onClick={() => handleSeasonChange("all")}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            All Time
          </button>
        )}
      </div>
    </div>
  );
}
