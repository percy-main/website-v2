import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
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
import { Link } from "react-router";

interface RecordEntry {
  playerName: string;
  slug: string | null;
  value: string;
  season: number;
  matchDate: string;
  opposition: string | null;
}

interface RecordsResponse {
  batting: {
    highestScore: RecordEntry | null;
    mostRunsSeason: RecordEntry | null;
    mostCareerRuns: RecordEntry | null;
    mostCareerMatches: RecordEntry | null;
  };
  bowling: {
    bestBowling: RecordEntry | null;
    mostWicketsSeason: RecordEntry | null;
    mostCareerWickets: RecordEntry | null;
  };
}

interface HonourEntry {
  playerName: string;
  slug: string | null;
  value: string;
  season: number;
  matchDate: string;
  opposition: string | null;
}

interface HonoursResponse {
  centuries: HonourEntry[];
  fiveWicketHauls: HonourEntry[];
}

function useRecords() {
  return useQuery({
    queryKey: ["records"],
    queryFn: () => api.get<RecordsResponse>("/records"),
    staleTime: 10 * 60 * 1000,
  });
}

function useHonoursBoard() {
  return useQuery({
    queryKey: ["records-honours"],
    queryFn: () => api.get<HonoursResponse>("/records/honours"),
    staleTime: 10 * 60 * 1000,
  });
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

function formatDetail(record: RecordEntry): string {
  const parts: string[] = [];
  if (record.opposition) {
    parts.push(`vs ${record.opposition}`);
  }
  if (record.season > 0) {
    parts.push(String(record.season));
  }
  return parts.join(", ");
}

function RecordCard({
  title,
  record,
}: {
  title: string;
  record: RecordEntry | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {record ? (
          <div>
            <div className="text-3xl font-bold text-green-800">
              {record.value}
            </div>
            <div className="mt-1">
              <PlayerLink name={record.playerName} slug={record.slug} />
            </div>
            <div className="mt-0.5 text-sm text-gray-500">
              {formatDetail(record)}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">No data yet</div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
          </CardHeader>
          <CardContent>
            <div className="h-8 w-16 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-gray-200" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HonoursTable({
  entries,
  type,
}: {
  entries: HonourEntry[];
  type: "batting" | "bowling";
}) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-gray-500">
        {type === "batting"
          ? "No centuries recorded yet."
          : "No five-wicket hauls recorded yet."}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">
            {type === "batting" ? "Score" : "Figures"}
          </TableHead>
          <TableHead className="hidden sm:table-cell">Opposition</TableHead>
          <TableHead className="text-right">Season</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, i) => (
          <TableRow key={`${entry.playerName}-${entry.matchDate}-${i}`}>
            <TableCell>
              <PlayerLink name={entry.playerName} slug={entry.slug} />
            </TableCell>
            <TableCell className="text-right font-bold">
              {entry.value}
            </TableCell>
            <TableCell className="hidden text-gray-600 sm:table-cell">
              {entry.opposition ? `vs ${entry.opposition}` : "-"}
            </TableCell>
            <TableCell className="text-right">{entry.season}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RecordsWall() {
  const [honoursTab, setHonoursTab] = useState<string>("centuries");
  const recordsQuery = useRecords();
  const honoursQuery = useHonoursBoard();

  const records = recordsQuery.data;
  const honours = honoursQuery.data;

  if (recordsQuery.error || honoursQuery.error) {
    return (
      <p className="py-4 text-center text-red-600">Failed to load records.</p>
    );
  }

  return (
    <div className="space-y-10">
      {/* All-Time Records */}
      <section>
        <h2 className="mb-4 text-2xl font-bold">All-Time Records</h2>
        {recordsQuery.isPending ? (
          <RecordsSkeleton />
        ) : records ? (
          <>
            <h3 className="mb-3 text-lg font-semibold text-gray-700">
              Batting
            </h3>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RecordCard
                title="Highest Individual Score"
                record={records.batting.highestScore}
              />
              <RecordCard
                title="Most Runs in a Season"
                record={records.batting.mostRunsSeason}
              />
              <RecordCard
                title="Most Career Runs"
                record={records.batting.mostCareerRuns}
              />
              <RecordCard
                title="Most Matches"
                record={records.batting.mostCareerMatches}
              />
            </div>
            <h3 className="mb-3 text-lg font-semibold text-gray-700">
              Bowling
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <RecordCard
                title="Best Bowling Figures"
                record={records.bowling.bestBowling}
              />
              <RecordCard
                title="Most Wickets in a Season"
                record={records.bowling.mostWicketsSeason}
              />
              <RecordCard
                title="Most Career Wickets"
                record={records.bowling.mostCareerWickets}
              />
            </div>
          </>
        ) : null}
      </section>

      {/* Honours Board */}
      <section>
        <h2 className="mb-4 text-2xl font-bold">Honours Board</h2>
        {honoursQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-200" />
            ))}
          </div>
        ) : honours ? (
          <Tabs
            value={honoursTab}
            onValueChange={setHonoursTab}
            className="w-full"
          >
            <TabsList>
              <TabsTrigger value="centuries">
                Centuries ({honours.centuries.length})
              </TabsTrigger>
              <TabsTrigger value="fiveWickets">
                5-Wicket Hauls ({honours.fiveWicketHauls.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="centuries">
              <HonoursTable entries={honours.centuries} type="batting" />
            </TabsContent>
            <TabsContent value="fiveWickets">
              <HonoursTable entries={honours.fiveWicketHauls} type="bowling" />
            </TabsContent>
          </Tabs>
        ) : null}
      </section>
    </div>
  );
}
