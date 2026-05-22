import { InstallPrompt } from "@/components/install-prompt.js";
import { DateSquare } from "@/components/primitives/date-square.js";
import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { isChargeOpen } from "@/features/charges/is-open.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import {
  gameIsoDate,
  oppositionName,
  played,
  type Game,
} from "@/features/games.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { canViewMatchdayAdmin, useSession } from "@/lib/auth-client.js";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  HistoryIcon,
  TrophyIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { Link } from "react-router";

type MyUpcomingMatch = ApiResponse<"/api/matchday/mine/upcoming">[number];

type ActiveAvailability = ApiResponse<"/api/availability/active">;
type ChargesResponse = ApiResponse<"/api/charges">;
type Charge = ChargesResponse["charges"][number];

/**
 * Mobile-first home dashboard — a feed of independently-loading cards.
 *
 * Each card uses its own react-query hook and renders its own skeleton +
 * error state so a slow endpoint never blocks the others. Per the design
 * directive: single purpose, single primary action per card.
 *
 * Cards (top → bottom on mobile):
 *   1. AvailabilityAwaitingCard
 *   2. OutstandingDonationsCard
 *   3. UpcomingFixturesCard
 *   4. RecentResultsCard
 *
 * The "You're on the team" card lands once we surface confirmed
 * matchdays the user is named on (uses /api/matchday/:id/public).
 */
export default function Home() {
  const { data: session } = useSession();
  const userName = session?.user.name ?? "there";
  const firstName = userName.split(/\s+/)[0];
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 md:py-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-[-0.015em] md:text-2xl">
          Hi {firstName}
        </h1>
        <span className="text-text-secondary text-xs md:text-sm">
          {format(new Date(), "EEEE, d MMM")}
        </span>
      </div>
      <div className="space-y-3">
        <NeedsAttentionCard />
        <AvailabilityAwaitingCard />
        <YourUpcomingGamesCard />
        <OutstandingDonationsCard />
        <UpcomingFixturesCard />
        <YourRecentPerformanceCard />
        <RecentResultsCard />
        <InstallPrompt />
      </div>
    </div>
  );
}

function NeedsAttentionCard() {
  // Officials-only endpoint — gate the query on the matchday:view
  // permission so non-officials never fire a request that's destined
  // for a 403. Used to be a per-team roll-up on the dropped /squad tab.
  const { data: session } = useSession();
  const enabled = canViewMatchdayAdmin(session?.user);
  const { data, isError } = useQuery({
    queryKey: ["matchday", "past-unfinished"],
    queryFn: () => callApi(api.GET("/api/matchday/past-unfinished")),
    enabled,
    retry: false,
  });
  if (!enabled || isError) return null;
  const items = data ?? [];
  if (items.length === 0) return null;
  const oldest = items[items.length - 1];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={CircleAlertIcon}>Needs attention</CardEyebrow>
          <StatusPill tone="warning" dot>
            {items.length} match{items.length === 1 ? "" : "es"}
          </StatusPill>
        </div>
        <CardTitle>
          {items.length === 1
            ? "1 match still needs wrapping up"
            : `${items.length} matches still need wrapping up`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-text-secondary mb-3 text-sm">
          {oldest.team_name ? `${oldest.team_name} · ` : ""}vs{" "}
          {oldest.opposition} ({fmtDate(oldest.match_date, "d MMM")}) is the
          oldest.
        </p>
        <Button asChild tone="primary" className="w-full">
          <Link to={`/matchday/${oldest.id}/wrap`}>
            Wrap the oldest
            <ArrowRightIcon className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function AvailabilityAwaitingCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load availability" />;

  const count = countUnansweredDates(data);
  // Quiet — don't take up real estate when there's nothing to do.
  if (count === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={CircleCheckIcon}>Availability</CardEyebrow>
          <StatusPill tone="warning" dot>
            {count} to answer
          </StatusPill>
        </div>
        <CardTitle>
          You've {count} {count === 1 ? "date" : "dates"} to confirm
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-text-secondary mb-3 text-sm">
          Manager picks the squad mid-week. Takes a minute.
        </p>
        <Button asChild tone="primary" className="w-full">
          <Link to="/availability/respond">
            Answer availability
            <ArrowRightIcon className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function YourUpcomingGamesCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["matchday", "mine", "upcoming"],
    queryFn: () => callApi(api.GET("/api/matchday/mine/upcoming")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load your selection" />;
  const games = data ?? [];
  if (games.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={UsersIcon}>Your upcoming games</CardEyebrow>
          <StatusPill tone="success" dot>
            You're in {games.length === 1 ? "1 team" : `${games.length} teams`}
          </StatusPill>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {games.map((g) => (
          <MyMatchRow key={g.matchdayId} match={g} />
        ))}
      </CardContent>
    </Card>
  );
}

function MyMatchRow({ match }: { match: MyUpcomingMatch }) {
  const role = match.isCaptain
    ? "Captain"
    : match.isWicketkeeper
      ? "Keeper"
      : null;
  return (
    <Link
      to={`/matchday/${match.matchdayId}`}
      className="border-border-light grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t py-2.5 first:border-t-0"
    >
      <DateSquare iso={match.matchDate} />
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight font-medium">
          {match.opposition}
        </div>
        <div className="text-text-secondary mt-0.5 text-xs">
          {[match.teamName, match.competitionType].filter(Boolean).join(" · ")}
        </div>
      </div>
      {role ? (
        <StatusPill tone="navy">{role}</StatusPill>
      ) : (
        <StatusPill tone="neutral">Selected</StatusPill>
      )}
    </Link>
  );
}

function YourRecentPerformanceCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["matchday", "mine", "recent-performance"],
    queryFn: () => callApi(api.GET("/api/matchday/mine/recent-performance")),
  });
  if (isLoading) return null;
  if (isError) return null;
  if (!data) return null;
  // Quiet card — hide when there's nothing to celebrate. A member who
  // played but scored 0/0/0 stays visible because matchesPlayed > 0
  // still tells a story ("you played 2 games").
  if (data.matchesPlayed === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={TrophyIcon}>Your recent performance</CardEyebrow>
          <span className="text-text-secondary text-xs">
            Last {data.windowDays} days
          </span>
        </div>
        <CardTitle>
          {data.matchesPlayed} {data.matchesPlayed === 1 ? "match" : "matches"}{" "}
          played
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          <PerfStat label="Runs" value={data.runs} />
          <PerfStat label="Wickets" value={data.wickets} />
          <PerfStat label="Catches" value={data.catches} />
        </div>
      </CardContent>
    </Card>
  );
}

function PerfStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-raised rounded-md py-3 text-center">
      <div className="text-navy text-2xl font-bold tracking-[-0.02em] dark:text-white">
        {value}
      </div>
      <div className="text-text-secondary mt-0.5 text-[11px] tracking-wide uppercase">
        {label}
      </div>
    </div>
  );
}

function countUnansweredDates(data: ActiveAvailability | undefined): number {
  if (!data) return 0;
  let n = 0;
  for (const item of data.items) {
    if (item.status !== "open") continue;
    const answered = new Set(item.myResponses.map((r) => r.match_date));
    const dates = new Set(item.fixtures.map((f) => f.match_date));
    for (const d of dates) if (!answered.has(d)) n++;
  }
  return n;
}

function OutstandingDonationsCard() {
  // Same query key as `donations.tsx` so the two views share a cache
  // entry; a mutation invalidating ["charges"] hits both, and a warm
  // cache on one populates the other without a refetch.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["charges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load donations" />;

  const charges = data?.charges ?? [];
  const outstanding = charges.filter(isChargeOpen);
  if (outstanding.length === 0) return null;
  const total = outstanding.reduce((acc, c) => acc + c.amount_pence, 0);
  const overdueCount = outstanding.filter(isOverdue).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={WalletIcon}>Outstanding donations</CardEyebrow>
          {overdueCount > 0 ? (
            <StatusPill tone="danger" dot>
              Overdue ×{overdueCount}
            </StatusPill>
          ) : (
            <StatusPill tone="warning" dot>
              {outstanding.length} unpaid
            </StatusPill>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-navy text-3xl font-bold tracking-[-0.02em] dark:text-white">
          {fmtMoneyPence(total)}
        </div>
        <p className="text-text-secondary mt-1 mb-3 text-sm">
          {outstanding.length} unpaid match{" "}
          {outstanding.length === 1 ? "donation" : "donations"}
        </p>
        <Button asChild tone="primary" className="w-full">
          <Link to="/donations">Pay {fmtMoneyPence(total)}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UpcomingFixturesCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load fixtures" />;

  const games = data ?? [];
  const todayIso = todayIsoDate();
  // matchDate from /api/games is DD/MM/YYYY — normalise to ISO before
  // comparing/sorting (lexical sort on DD/MM/YYYY is wrong, new Date()
  // is locale-dependent).
  const upcoming = games
    .map((g) => ({ g, iso: gameIsoDate(g) }))
    .filter((row) => !played(row.g) && row.iso !== null && row.iso >= todayIso)
    .sort((a, b) => (a.iso ?? "").localeCompare(b.iso ?? ""))
    .slice(0, 3)
    .map((row) => row.g);
  if (upcoming.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={CalendarDaysIcon}>Upcoming fixtures</CardEyebrow>
          <Link to="/fixtures" className="text-text-secondary text-xs">
            See all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {upcoming.map((g) => (
          <FixtureRow key={g.id} game={g} />
        ))}
      </CardContent>
    </Card>
  );
}

function RecentResultsCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  if (isLoading) return null;
  if (isError) return null;
  const games = data ?? [];
  const recent = games
    .filter(played)
    .map((g) => ({ g, iso: gameIsoDate(g) ?? "" }))
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .slice(0, 3)
    .map((row) => row.g);
  if (recent.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow icon={HistoryIcon}>Recent results</CardEyebrow>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {recent.map((g) => (
          <FixtureRow key={g.id} game={g} />
        ))}
      </CardContent>
    </Card>
  );
}

function FixtureRow({ game }: { game: Game }) {
  // Use the normalised ISO form for date math — game.matchDate is
  // Play-Cricket's DD/MM/YYYY which `new Date(...)` parses wrong.
  const iso = gameIsoDate(game);
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="border-border-light grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t py-2.5 first:border-t-0"
    >
      <DateSquare iso={iso} />
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight font-medium">
          {oppositionName(game)}
        </div>
        <div className="text-text-secondary mt-0.5 text-xs">
          {[game.team.name, game.home ? "Home" : "Away", game.competition.name]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {played(game) ? <ResultPill game={game} /> : <TimePill game={game} />}
    </Link>
  );
}

function TimePill({ game }: { game: Game }) {
  return <StatusPill tone="neutral">{game.matchTime ?? "TBC"}</StatusPill>;
}

function ResultPill({ game }: { game: Game }) {
  const o = game.outcome;
  // Bigger, clearly-typed pill — recent results should read like a
  // result, not a status. Falls back to the single-letter outcome
  // when Play-Cricket hasn't populated a score description yet.
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

function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="bg-border h-3 w-24 rounded-md" />
      </CardHeader>
      <CardContent>
        <div className="bg-border mb-2 h-5 w-3/4 rounded-md" />
        <div className="bg-border-light mb-3 h-4 w-1/2 rounded-md" />
        <div className="bg-border h-11 rounded-md" />
      </CardContent>
    </Card>
  );
}

function CardError({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="text-text-secondary flex items-center gap-2 pt-4 text-sm">
        <CalendarDaysIcon className="size-4" />
        {label}
      </CardContent>
    </Card>
  );
}

/** Today as a YYYY-MM-DD ISO date — for string comparison against gameIsoDate. */
function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isOverdue(c: Charge): boolean {
  if (!c.created_at) return false;
  const created = new Date(c.created_at);
  const days = (Date.now() - created.getTime()) / 86_400_000;
  return days > 14;
}
