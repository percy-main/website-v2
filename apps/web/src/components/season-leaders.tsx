import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { api } from "@/lib/api.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

interface BattingEntry {
  playerId: string;
  playerName: string;
  contentfulEntryId: string | null;
  innings: number;
  runs: number;
  highScore: number | null;
  average: number | null;
}

interface BowlingEntry {
  playerId: string;
  playerName: string;
  contentfulEntryId: string | null;
  wickets: number;
  overs: string;
  average: number | null;
}

interface LeaderboardResponse<T> {
  entries: T[];
}

function currentCricketSeason(): number {
  const now = new Date();
  // Cricket season runs April–September; Jan–Mar use previous year
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

function PlayerLink({ name, slug }: { name: string; slug: string | null }) {
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
  children,
  headers,
}: {
  title: string;
  children: React.ReactNode;
  headers: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </h4>
      <Table>
        <TableHeader>
          <TableRow>{headers}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

/**
 * Resolve a player name to a person slug for profile linking.
 * Uses dynamic import to avoid pulling all people data into the component.
 */
function usePersonSlugMap() {
  // This runs once on mount
  const { data: slugMap } = useQuery({
    queryKey: ["person-slug-map"],
    queryFn: async () => {
      const { getPersonBySlug } = await import("@/lib/people.js");
      // We need all people, but people.ts only exports getPersonBySlug.
      // We'll build a name→slug map by trying common slug formats.
      // This is a workaround; we return the lookup function instead.
      return { getPersonBySlug };
    },
    staleTime: Infinity,
  });

  return (name: string): string | null => {
    if (!slugMap) return null;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim();
    const person = slugMap.getPersonBySlug(slug);
    if (person) return slug;

    // Try first + last name only
    const parts = name.split(" ");
    if (parts.length > 2) {
      const simpleSlug = `${parts[0]}-${parts[parts.length - 1]}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      const simplePerson = slugMap.getPersonBySlug(simpleSlug);
      if (simplePerson) return simpleSlug;
    }
    return null;
  };
}

export function SeasonLeaders() {
  const season = currentCricketSeason();
  const resolveSlug = usePersonSlugMap();

  const battingQuery = useQuery({
    queryKey: ["season-leaders-batting", season],
    queryFn: async () => {
      const primary = await api.get<LeaderboardResponse<BattingEntry>>(
        `/cricket-leaderboard/batting?season=${season}&limit=3`,
      );
      if (primary.entries.length > 0) {
        return { data: primary, season };
      }
      const fallback = await api.get<LeaderboardResponse<BattingEntry>>(
        `/cricket-leaderboard/batting?season=${season - 1}&limit=3`,
      );
      return { data: fallback, season: season - 1 };
    },
    staleTime: 10 * 60 * 1000,
  });

  const bowlingQuery = useQuery({
    queryKey: ["season-leaders-bowling", season],
    queryFn: async () => {
      const primary = await api.get<LeaderboardResponse<BowlingEntry>>(
        `/cricket-leaderboard/bowling?season=${season}&limit=3`,
      );
      if (primary.entries.length > 0) {
        return { data: primary, season };
      }
      const fallback = await api.get<LeaderboardResponse<BowlingEntry>>(
        `/cricket-leaderboard/bowling?season=${season - 1}&limit=3`,
      );
      return { data: fallback, season: season - 1 };
    },
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = battingQuery.isLoading || bowlingQuery.isLoading;
  const hasError = battingQuery.error ?? bowlingQuery.error;

  if (hasError) return null;

  const battingEntries = battingQuery.data?.data?.entries ?? [];
  const bowlingEntries = bowlingQuery.data?.data?.entries ?? [];

  const effectiveSeason =
    battingQuery.data?.season ?? bowlingQuery.data?.season ?? season;

  if (!isLoading && battingEntries.length === 0 && bowlingEntries.length === 0)
    return null;

  return (
    <div>
      <h3
        className="font-secondary mb-6 text-center font-bold"
        style={{ fontSize: "var(--text-h4)" }}
      >
        Season Leaders
      </h3>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="h-8 animate-pulse rounded bg-gray-100"
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
              headers={
                <>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    HS
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Avg
                  </TableHead>
                </>
              }
            >
              {battingEntries.map((entry, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-gray-400">{idx + 1}</TableCell>
                  <TableCell>
                    <PlayerLink
                      name={entry.playerName}
                      slug={resolveSlug(entry.playerName)}
                    />
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
              headers={
                <>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Wkts</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Overs
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Avg
                  </TableHead>
                </>
              }
            >
              {bowlingEntries.map((entry, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-gray-400">{idx + 1}</TableCell>
                  <TableCell>
                    <PlayerLink
                      name={entry.playerName}
                      slug={resolveSlug(entry.playerName)}
                    />
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
          to={`/leaderboard/${effectiveSeason}`}
          className="text-primary hover:text-primary-light text-sm font-medium transition"
        >
          View full {effectiveSeason} leaderboard &rarr;
        </Link>
      </div>
    </div>
  );
}
