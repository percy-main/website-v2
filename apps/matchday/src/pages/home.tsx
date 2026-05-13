import { InstallPrompt } from "@/components/install-prompt.js";
import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardEyebrow, CardHeader, CardTitle } from "@/components/ui/card.js";
import { fmtMoneyPence } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useSession } from "@/lib/auth-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CalendarDaysIcon } from "lucide-react";
import { Link } from "react-router";

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
 * matchdays the user is named on (uses the new /api/matchday/:id/public
 * endpoint — see Phase 2 plan).
 */
export default function Home() {
  const { data: session } = useSession();
  const userName = session?.user.name ?? "there";
  const firstName = userName.split(/\s+/)[0];
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 md:py-8">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">
          Hi {firstName}
        </h1>
        <p className="text-sm text-text-secondary">
          What needs doing on Matchday today.
        </p>
      </div>
      <div className="space-y-3">
        <AvailabilityAwaitingCard />
        <OutstandingDonationsCard />
        <UpcomingFixturesCard />
        <RecentResultsCard />
        <InstallPrompt />
      </div>
    </div>
  );
}

function AvailabilityAwaitingCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load availability" />;

  // The shape is a list of active requests. Unanswered count is whatever
  // dates the player hasn't yet responded to.
  const requests = (data as unknown as { requests?: ActiveRequest[] } | undefined)
    ?.requests;
  const dates = requests?.flatMap((r) =>
    (r.dates ?? []).filter((d) => d.myResponse === null || d.myResponse === undefined),
  );
  const count = dates?.length ?? 0;
  if (count === 0) {
    // Quiet — don't take up real estate when there's nothing to do.
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow>Availability</CardEyebrow>
          <StatusPill tone="warning" dot>
            {count} to answer
          </StatusPill>
        </div>
        <CardTitle>
          You've {count} {count === 1 ? "date" : "dates"} to confirm
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
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

function OutstandingDonationsCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["charges", "outstanding"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load donations" />;

  const charges = (data as unknown as { charges?: ChargeRow[] } | undefined)
    ?.charges;
  const outstanding = charges?.filter(
    (c) => c.paidAt === null && c.voidedAt === null && c.relievedAt === null,
  );
  const total = outstanding?.reduce(
    (acc, c) => acc + (Number(c.amountPence) || 0),
    0,
  );
  if (!outstanding || outstanding.length === 0) return null;
  const overdueCount = outstanding.filter((c) => isOverdue(c)).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow>Outstanding donations</CardEyebrow>
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
        <div className="text-3xl font-bold tracking-[-0.02em] text-navy dark:text-white">
          {fmtMoneyPence(total)}
        </div>
        <p className="mt-1 mb-3 text-sm text-text-secondary">
          {outstanding.length} unpaid match{" "}
          {outstanding.length === 1 ? "donation" : "donations"}
        </p>
        <Button asChild tone="primary" className="w-full">
          <a
            href={mainSiteUrl("/members/charges")}
            rel="noopener"
            target="_blank"
          >
            Pay on main site ↗
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function UpcomingFixturesCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["games", "upcoming"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load fixtures" />;

  const games = (data as unknown as { games?: GameRow[] } | undefined)?.games ??
    [];
  const upcoming = games
    .filter((g) => !g.played && new Date(g.date) >= todayMidnight())
    .slice(0, 3);
  if (upcoming.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow>Upcoming fixtures</CardEyebrow>
          <Link to="/fixtures" className="text-xs text-text-secondary">
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
    queryKey: ["games", "recent"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  if (isLoading) return null;
  if (isError) return null;
  const games = (data as unknown as { games?: GameRow[] } | undefined)?.games ??
    [];
  const recent = games
    .filter((g) => g.played)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 3);
  if (recent.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow>Recent results</CardEyebrow>
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

function FixtureRow({ game }: { game: GameRow }) {
  const d = new Date(game.date);
  const day = d.getDate();
  const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border-light py-2.5 first:border-t-0"
    >
      <div className="flex flex-col items-center justify-center rounded-md bg-surface-raised py-1">
        <div className="text-base font-bold leading-none text-navy dark:text-white">
          {day}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-text-secondary">
          {dayName}
        </div>
      </div>
      <div>
        <div className="text-sm font-medium leading-tight">
          {game.away ? "vs " : "at "}
          {game.opposition ?? "TBC"}
        </div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {[game.teamName, game.away ? "Away" : "Home", game.competition]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {game.played ? <ResultPill game={game} /> : <TimePill game={game} />}
    </Link>
  );
}

function TimePill({ game }: { game: GameRow }) {
  return (
    <StatusPill tone="neutral">
      {game.startTime ?? new Date(game.date).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </StatusPill>
  );
}

function ResultPill({ game }: { game: GameRow }) {
  const result = game.result?.toUpperCase();
  if (result === "W") return <StatusPill tone="success">W</StatusPill>;
  if (result === "L") return <StatusPill tone="danger">L</StatusPill>;
  if (result === "D" || result === "T")
    return <StatusPill tone="warning">{result}</StatusPill>;
  return <StatusPill tone="neutral">{result ?? "—"}</StatusPill>;
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-3 w-24 rounded-md bg-border" />
      </CardHeader>
      <CardContent>
        <div className="mb-2 h-5 w-3/4 rounded-md bg-border" />
        <div className="mb-3 h-4 w-1/2 rounded-md bg-border-light" />
        <div className="h-11 rounded-md bg-border" />
      </CardContent>
    </Card>
  );
}

function CardError({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 pt-4 text-sm text-text-secondary">
        <CalendarDaysIcon className="size-4" />
        {label}
      </CardContent>
    </Card>
  );
}

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isOverdue(c: ChargeRow): boolean {
  if (!c.createdAt) return false;
  const created = new Date(c.createdAt);
  const days = (Date.now() - created.getTime()) / 86_400_000;
  return days > 14;
}

// Local types — kept loose; rely on the underlying openapi-fetch typing
// to surface real shape mismatches at compile time. Tightening these to
// the api.gen `paths` extracts is a phase-3 cleanup.
interface ActiveRequest {
  id: string;
  dates: ActiveRequestDate[];
}
interface ActiveRequestDate {
  date: string;
  fixtures?: unknown[];
  myResponse?: "available" | "unavailable" | null;
}
interface ChargeRow {
  id: string;
  amountPence: number | string;
  paidAt: string | null;
  voidedAt: string | null;
  relievedAt: string | null;
  createdAt: string | null;
}
interface GameRow {
  id: string;
  date: string;
  startTime?: string;
  teamName?: string;
  opposition?: string;
  competition?: string;
  away: boolean;
  played: boolean;
  result?: string | null;
}

// `react-router`'s Link supports asChild via the Button wrapper.
declare module "@/components/ui/button" {}
