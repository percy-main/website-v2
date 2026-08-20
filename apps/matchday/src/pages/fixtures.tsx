import { DateSquare } from "@/components/primitives/date-square.js";
import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import {
  gameIsoDate,
  oppositionName,
  played,
  type Game,
} from "@/features/games.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { canManageMatchday, useSession } from "@/lib/auth-client.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PlusIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";

type CustomFixture = ApiResponse<"/api/matchday/custom-fixtures">[number];

/**
 * One row in the fixtures list — either a Play-Cricket game or a custom
 * matchday (a club-arranged game with no Play-Cricket record). The
 * shared fields drive filtering/bucketing; `item` keeps the full
 * payload for rendering and links each kind to its own detail page.
 */
interface Entry {
  key: string;
  iso: string | null;
  teamName: string;
  isPlayed: boolean;
  item: { kind: "pc"; game: Game } | { kind: "custom"; fixture: CustomFixture };
}

const FILTERS = [
  { key: "all", label: "All", pred: (_: string) => true },
  {
    key: "1st",
    label: "1st XI",
    pred: (name: string) => name.toLowerCase().includes("1st"),
  },
  {
    key: "2nd",
    label: "2nd XI",
    pred: (name: string) => name.toLowerCase().includes("2nd"),
  },
  {
    key: "mid",
    label: "Midweek XI",
    pred: (name: string) => /midweek/i.test(name),
  },
  {
    key: "womens",
    label: "Women's Softball",
    pred: (name: string) => /women/i.test(name),
  },
  {
    key: "juniors",
    label: "Juniors",
    pred: (name: string) => /under|junior|colts|\bU\d{2}\b/i.test(name),
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
  const { data: session } = useSession();
  const canCreate = canManageMatchday(session?.user);

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

  const gamesQuery = useQuery({
    queryKey: ["games"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  const customQuery = useQuery({
    queryKey: ["matchday", "custom-fixtures"],
    queryFn: () => callApi(api.GET("/api/matchday/custom-fixtures")),
  });
  const isLoading = gamesQuery.isLoading || customQuery.isLoading;
  // One feed failing shouldn't blank the other — only report an error
  // when there's nothing at all to show.
  const isError = gamesQuery.isError && customQuery.isError;
  const entries: Entry[] = [
    ...(gamesQuery.data ?? []).map((g) => ({
      key: `pc-${g.id}`,
      iso: gameIsoDate(g),
      teamName: g.team.name,
      isPlayed: played(g),
      item: { kind: "pc" as const, game: g },
    })),
    ...(customQuery.data ?? []).map((f) => ({
      key: `md-${f.matchdayId}`,
      iso: f.matchDate,
      teamName: f.teamName ?? "",
      isPlayed: f.resultType !== null,
      item: { kind: "custom" as const, fixture: f },
    })),
  ];
  const selected = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = entries.filter((e) => selected.pred(e.teamName));
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
      {canCreate && (
        <div className="flex justify-end px-4 pb-2">
          <Button asChild tone="outline" size="sm">
            <Link to="/matchday/new">
              <PlusIcon /> New match
            </Link>
          </Button>
        </div>
      )}
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
                  items.map((e) =>
                    e.item.kind === "pc" ? (
                      <FixtureItem key={e.key} game={e.item.game} />
                    ) : (
                      <CustomFixtureItem key={e.key} fixture={e.item.fixture} />
                    ),
                  )}
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
        <StatusPill tone={resultTone(game.outcome)} size="lg">
          {game.scoreDescription ?? game.outcome ?? "—"}
        </StatusPill>
      ) : (
        <StatusPill tone="neutral">{game.matchTime ?? "TBC"}</StatusPill>
      )}
    </Link>
  );
}

/**
 * A custom matchday row. No Play-Cricket game page exists for these, so
 * it links to the team sheet — which carries manage links for officials.
 */
function CustomFixtureItem({ fixture }: { fixture: CustomFixture }) {
  return (
    <Link
      to={`/matchday/${fixture.matchdayId}`}
      className="border-border-light bg-surface grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t px-4 py-3 first:border-t-0"
    >
      <DateSquare iso={fixture.matchDate} dayLabel="month" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{fixture.opposition}</div>
        <div className="text-text-secondary mt-0.5 text-xs">
          {[
            fixture.teamName,
            fixture.isHome === null ? null : fixture.isHome ? "Home" : "Away",
            fixture.competitionType,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {fixture.resultType !== null ? (
        <StatusPill tone={resultTone(fixture.resultType)} size="lg">
          {fixture.resultType}
        </StatusPill>
      ) : (
        <StatusPill tone="neutral">{fixture.matchTime ?? "TBC"}</StatusPill>
      )}
    </Link>
  );
}

function resultTone(o: string | null) {
  if (o === "W") return "success" as const;
  if (o === "L") return "danger" as const;
  if (o === "D" || o === "T") return "warning" as const;
  return "neutral" as const;
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

function groupByBucket(entries: Entry[]): Record<BucketKey, Entry[]> {
  // All comparisons happen on the ISO-normalised date — Play-Cricket
  // gives us DD/MM/YYYY which `new Date(...)` parses inconsistently
  // across browsers and breaks string-sort. Custom fixtures are ISO
  // already.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const compare = (a: Entry, b: Entry) =>
    (a.iso ?? "").localeCompare(b.iso ?? "");

  const dateOf = (e: Entry) => {
    if (!e.iso) return null;
    const d = new Date(e.iso);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const out: Record<BucketKey, Entry[]> = {
    recent: [],
    next: [],
    future: [],
  };
  for (const e of entries) {
    const d = dateOf(e);
    // Anything in the past or already played belongs in Recent -
    // including past-date matches whose result hasn't been entered
    // yet, which previously leaked into "This week".
    if (e.isPlayed || (d && d < today)) {
      out.recent.push(e);
      continue;
    }
    if (!d || d < nextWeekEnd) out.next.push(e);
    else out.future.push(e);
  }
  out.next.sort(compare);
  out.future.sort(compare);
  out.recent.sort((a, b) => compare(b, a));
  out.recent = out.recent.slice(0, 8);
  return out;
}
