import { StatusPill } from "@/components/primitives/status-pill.js";
import { fmtDate } from "@/features/format.js";
import { oppositionName, played, type Game } from "@/features/games.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

const FILTERS = [
  { key: "all", label: "All", pred: (_: Game) => true },
  {
    key: "1st",
    label: "1st XI",
    pred: (g: Game) => g.team.name.toLowerCase().includes("1st"),
  },
  {
    key: "2nd",
    label: "2nd XI",
    pred: (g: Game) => g.team.name.toLowerCase().includes("2nd"),
  },
] as const;

export default function Fixtures() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  const games = data ?? [];
  const selected = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = games.filter(selected.pred);
  const groups = groupByBucket(filtered);
  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pb-2 pt-6">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Fixtures</h1>
      </header>
      <div className="flex gap-2 overflow-x-auto px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium",
              f.key === filter
                ? "border-navy bg-navy text-white"
                : "border-border bg-surface text-text-secondary",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {isLoading && <FixtureSkeleton />}
      {isError && (
        <p className="px-4 py-6 text-sm text-text-secondary">
          Couldn't load fixtures.
        </p>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <p className="px-4 py-12 text-center text-sm text-text-secondary">
          No fixtures match this filter.
        </p>
      )}
      {!isLoading && !isError && (
        <div>
          {(["This week", "Next week", "Later this month", "Recent"] as const).map(
            (bucket) =>
              groups[bucket].length > 0 && (
                <section key={bucket}>
                  <h2 className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                    {bucket}
                  </h2>
                  {groups[bucket].map((g) => (
                    <FixtureItem key={g.id} game={g} />
                  ))}
                </section>
              ),
          )}
        </div>
      )}
    </div>
  );
}

function FixtureItem({ game }: { game: Game }) {
  const d = new Date(game.matchDate);
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border-light bg-surface px-4 py-3 first:border-t-0"
    >
      <div className="flex flex-col items-center justify-center rounded-md bg-surface-raised py-1">
        <div className="text-base font-bold leading-none text-navy dark:text-white">
          {d.getDate()}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-text-secondary">
          {fmtDate(game.matchDate, "MMM")}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          vs {oppositionName(game)}
        </div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {[game.team.name, game.home ? "Home" : "Away", game.competition.name]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {played(game) ? (
        <FixtureResultPill game={game} />
      ) : (
        <StatusPill tone="neutral">{game.matchTime ?? "TBC"}</StatusPill>
      )}
    </Link>
  );
}

function FixtureResultPill({ game }: { game: Game }) {
  const o = game.outcome;
  const label = game.scoreDescription ?? o ?? "—";
  if (o === "W") return <StatusPill tone="success">{label}</StatusPill>;
  if (o === "L") return <StatusPill tone="danger">{label}</StatusPill>;
  if (o === "D" || o === "T")
    return <StatusPill tone="warning">{label}</StatusPill>;
  return <StatusPill tone="neutral">{label}</StatusPill>;
}

function FixtureSkeleton() {
  return (
    <div className="space-y-2 px-4 py-3">
      {["a", "b", "c", "d"].map((slot) => (
        <div key={slot} className="flex items-center gap-3">
          <div className="size-11 rounded-md bg-border" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded-md bg-border" />
            <div className="h-3 w-1/2 rounded-md bg-border-light" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Bucket = "This week" | "Next week" | "Later this month" | "Recent";

function groupByBucket(games: Game[]): Record<Bucket, Game[]> {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const inDays = (date: string, days: number) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return (d.getTime() - now.getTime()) / 86_400_000 <= days;
  };
  const out: Record<Bucket, Game[]> = {
    "This week": [],
    "Next week": [],
    "Later this month": [],
    Recent: [],
  };
  for (const g of games) {
    if (played(g)) {
      out.Recent.push(g);
      continue;
    }
    if (inDays(g.matchDate, 7)) out["This week"].push(g);
    else if (inDays(g.matchDate, 14)) out["Next week"].push(g);
    else out["Later this month"].push(g);
  }
  out["This week"].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  out["Next week"].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  out["Later this month"].sort((a, b) =>
    a.matchDate.localeCompare(b.matchDate),
  );
  out.Recent.sort((a, b) => b.matchDate.localeCompare(a.matchDate));
  out.Recent = out.Recent.slice(0, 8);
  return out;
}
