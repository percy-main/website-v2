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
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

function useRecords() {
  return useQuery({
    queryKey: ["records"],
    queryFn: () => callApi(api.GET("/api/records")),
    staleTime: 10 * 60 * 1000,
  });
}

function useHonoursBoard() {
  return useQuery({
    queryKey: ["records-honours"],
    queryFn: () => callApi(api.GET("/api/records/honours")),
    staleTime: 10 * 60 * 1000,
  });
}

function PlayerLink({ name, slug }: { name: string; slug: string | null }) {
  if (slug) {
    return (
      <Link
        to={`/person/${slug}`}
        className="text-primary decoration-cta/70 hover:text-cta font-medium underline underline-offset-2"
      >
        {name}
      </Link>
    );
  }
  return <span className="font-medium">{name}</span>;
}

type RecordsData = Awaited<ReturnType<typeof useRecords>>["data"];
type RecordItem = NonNullable<RecordsData>["records"][number];

type HonoursData = Awaited<ReturnType<typeof useHonoursBoard>>["data"];
type HonourEntry = NonNullable<HonoursData>["centuries"][number];

function RecordCard({ record }: { record: RecordItem }) {
  return (
    <div className="border-primary bg-surface border-2 p-4">
      <div className="text-muted pb-2 text-sm font-medium">{record.title}</div>
      <div className="text-primary text-3xl font-bold">{record.value}</div>
      <div className="mt-1">
        <PlayerLink name={record.playerName} slug={record.slug} />
      </div>
      {record.season > 0 && (
        <div className="text-muted mt-0.5 text-sm">{record.season}</div>
      )}
    </div>
  );
}

function RecordsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="border-primary bg-surface border-2 p-4">
          <div className="bg-primary/10 h-4 w-24 animate-pulse rounded" />
          <div className="bg-primary/10 mt-2 h-8 w-16 animate-pulse rounded" />
          <div className="bg-primary/10 mt-2 h-4 w-32 animate-pulse rounded" />
        </div>
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
      <p className="text-muted py-8 text-center">
        {type === "batting"
          ? "No centuries recorded yet."
          : "No five-wicket hauls recorded yet."}
      </p>
    );
  }

  return (
    <div className="fc-stat">
      <Table>
        <caption className="sr-only">
          {type === "batting" ? "Centuries" : "Five-wicket hauls"}
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Player</TableHead>
            <TableHead scope="col" className="text-right">
              {type === "batting" ? "Score" : "Figures"}
            </TableHead>
            <TableHead scope="col" className="text-right">
              Season
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow
              key={`${entry.playerName}-${entry.matchDate}-${entry.value}`}
            >
              <TableCell>
                <PlayerLink name={entry.playerName} slug={entry.slug} />
              </TableCell>
              <TableCell className="text-right font-bold">
                {entry.value}
              </TableCell>
              <TableCell className="text-right">{entry.season}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
      <p className="py-4 text-center text-red-700">Failed to load records.</p>
    );
  }

  return (
    <div className="space-y-10">
      {/* All-Time Records */}
      <section>
        <h2 className="fc-two-tone mb-4 text-2xl font-semibold">
          All-Time Records
        </h2>
        {recordsQuery.isPending ? (
          <RecordsSkeleton />
        ) : records ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {records.records.map((record) => (
              <RecordCard key={record.title} record={record} />
            ))}
          </div>
        ) : null}
      </section>

      {/* Honours Board */}
      <section>
        <h2 className="fc-two-tone mb-4 text-2xl font-semibold">
          Honours Board
        </h2>
        {honoursQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="bg-primary/10 h-10 animate-pulse rounded"
              />
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
