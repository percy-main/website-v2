import { DateSquare } from "@/components/primitives/date-square.js";
import { StatusPill } from "@/components/primitives/status-pill.js";
import {
  gameIsoDate,
  oppositionName,
  played,
  type Game,
} from "@/features/games.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Link, useSearchParams } from "react-router";

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
  {
    key: "mid",
    label: "Midweek XI",
    pred: (g: Game) => /midweek/i.test(g.team.name),
  },
  {
    key: "womens",
    label: "Women's Softball",
    pred: (g: Game) => /women/i.test(g.team.name),
  },
  {
    key: "juniors",
    label: "Juniors",
    pred: (g: Game) => /under|junior|colts|\bU\d{2}\b/i.test(g.team.name),
  },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const BUCKETS = [
  { key: "next", label: "Next week" },
  { key: "recent", label: "Recent" },
  { key: "future", label: "Future" },
] as const;
type BucketKey = (typeof BUCKETS)[number]["key"];
const DEFAULT_OPEN: ReadonlySet<BucketKey> = new Set(["next"]);

export default function Fixtures() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get("filter");
  const filter: FilterKey =
    FILTERS.find((f) => f.key === filterParam)?.key ?? "all";
  const openSet = parseOpen(searchParams.get("open"));

  const setFilter = (next: FilterKey) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("filter");
        else params.set("filter", next);
        return params;
      },
      { replace: true },
    );
  };

  const toggleBucket = (key: BucketKey) => {
    const nextOpen = new Set(openSet);
    if (nextOpen.has(key)) nextOpen.delete(key);
    else nextOpen.add(key);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (sameSet(nextOpen, DEFAULT_OPEN)) params.delete("open");
        else params.set("open", serialiseOpen(nextOpen));
        return params;
      },
      { replace: true },
    );
  };

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
      <header className="hidden px-4 pt-6 pb-2 md:block">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Fixtures</h1>
      </header>
      <div className="flex gap-2 overflow-x-auto px-4 py-3 md:py-2">
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
      {!isLoading && !isError && filtered.length > 0 && (
        <div>
          {BUCKETS.map(({ key, label }) => {
            const items = groups[key];
            if (items.length === 0) return null;
            const isOpen = openSet.has(key);
            return (
              <section key={key}>
                <button
                  type="button"
                  onClick={() => toggleBucket(key)}
                  aria-expanded={isOpen}
                  className="text-text-secondary flex w-full items-center justify-between px-4 pt-4 pb-2 text-[11px] font-semibold tracking-[0.06em] uppercase"
                >
                  <span>
                    {label}
                    <span className="text-text-secondary ml-2 normal-case opacity-70">
                      ({items.length})
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      isOpen ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </button>
                {isOpen &&
                  items.map((g) => <FixtureItem key={g.id} game={g} />)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FixtureItem({ game }: { game: Game }) {
  // Play-Cricket sends DD/MM/YYYY — normalise to ISO before passing to
  // new Date(), which is otherwise locale-dependent.
  const iso = gameIsoDate(game);
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="border-border-light bg-surface grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t px-4 py-3 first:border-t-0"
    >
      <DateSquare iso={iso} dayLabel="month" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {oppositionName(game)}
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
  const tone =
    o === "W"
      ? ("success" as const)
      : o === "L"
        ? ("danger" as const)
        : o === "D" || o === "T"
          ? ("warning" as const)
          : ("neutral" as const);
  const label = game.scoreDescription ?? o ?? "—";
  return (
    <StatusPill tone={tone} size="lg">
      {label}
    </StatusPill>
  );
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

function parseOpen(raw: string | null): Set<BucketKey> {
  if (raw === null) return new Set(DEFAULT_OPEN);
  if (raw === "") return new Set();
  const valid = new Set(BUCKETS.map((b) => b.key));
  return new Set(
    raw.split(",").filter((k): k is BucketKey => valid.has(k as BucketKey)),
  );
}

function serialiseOpen(set: Set<BucketKey>): string {
  return BUCKETS.map((b) => b.key)
    .filter((k) => set.has(k))
    .join(",");
}

function sameSet<T>(a: Set<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function groupByBucket(games: Game[]): Record<BucketKey, Game[]> {
  // All comparisons happen on the ISO-normalised date — Play-Cricket
  // gives us DD/MM/YYYY which `new Date(...)` parses inconsistently
  // across browsers and breaks string-sort.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const byIso = new Map<string, string | null>();
  for (const g of games) byIso.set(g.id, gameIsoDate(g));
  const isoFor = (g: Game) => byIso.get(g.id) ?? null;
  const compare = (a: Game, b: Game) =>
    (isoFor(a) ?? "").localeCompare(isoFor(b) ?? "");

  const dateOf = (g: Game) => {
    const iso = isoFor(g);
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const out: Record<BucketKey, Game[]> = {
    recent: [],
    next: [],
    future: [],
  };
  for (const g of games) {
    const d = dateOf(g);
    // Anything in the past or already played belongs in Recent -
    // including past-date matches whose result hasn't been entered
    // yet, which previously leaked into "This week".
    if (played(g) || (d && d < today)) {
      out.recent.push(g);
      continue;
    }
    if (!d || d < nextWeekEnd) out.next.push(g);
    else out.future.push(g);
  }
  out.next.sort(compare);
  out.future.sort(compare);
  out.recent.sort((a, b) => compare(b, a));
  out.recent = out.recent.slice(0, 8);
  return out;
}
