import { StatusPill } from "@/components/primitives/status-pill.js";
import { fmtDate } from "@/features/format.js";
import {
  gameIsoDate,
  oppositionName,
  played,
  type Game,
} from "@/features/games.js";
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
      <header className="px-4 pt-6 pb-2">
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
        <p className="text-text-secondary px-4 py-6 text-sm">
          Couldn't load fixtures.
        </p>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-text-secondary px-4 py-12 text-center text-sm">
          No fixtures match this filter.
        </p>
      )}
      {!isLoading && !isError && (
        <div>
          {(
            ["This week", "Next week", "Later this month", "Recent"] as const
          ).map(
            (bucket) =>
              groups[bucket].length > 0 && (
                <section key={bucket}>
                  <h2 className="text-text-secondary px-4 pt-4 pb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
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
  // Play-Cricket sends DD/MM/YYYY — normalise to ISO before passing to
  // new Date(), which is otherwise locale-dependent.
  const iso = gameIsoDate(game);
  const d = iso ? new Date(iso) : null;
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="border-border-light bg-surface grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t px-4 py-3 first:border-t-0"
    >
      <div className="bg-surface-raised flex flex-col items-center justify-center rounded-md py-1">
        <div className="text-navy text-base leading-none font-bold dark:text-white">
          {d ? d.getDate() : ""}
        </div>
        <div className="text-text-secondary text-[10px] tracking-wide uppercase">
          {fmtDate(game.matchDate, "MMM")}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          vs {oppositionName(game)}
        </div>
        <div className="text-text-secondary mt-0.5 text-xs">
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
          <div className="bg-border size-11 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="bg-border h-4 w-2/3 rounded-md" />
            <div className="bg-border-light h-3 w-1/2 rounded-md" />
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
  // All comparisons happen on the ISO-normalised date — Play-Cricket
  // gives us DD/MM/YYYY which `new Date(...)` parses inconsistently
  // across browsers and breaks string-sort.
  const inDays = (iso: string | null, days: number) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    return (d.getTime() - now.getTime()) / 86_400_000 <= days;
  };
  const byIso = new Map<string, string | null>();
  for (const g of games) byIso.set(g.id, gameIsoDate(g));
  const isoFor = (g: Game) => byIso.get(g.id) ?? null;
  const compare = (a: Game, b: Game) =>
    (isoFor(a) ?? "").localeCompare(isoFor(b) ?? "");

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
    const iso = isoFor(g);
    if (inDays(iso, 7)) out["This week"].push(g);
    else if (inDays(iso, 14)) out["Next week"].push(g);
    else out["Later this month"].push(g);
  }
  out["This week"].sort(compare);
  out["Next week"].sort(compare);
  out["Later this month"].sort(compare);
  out.Recent.sort((a, b) => compare(b, a));
  out.Recent = out.Recent.slice(0, 8);
  return out;
}
