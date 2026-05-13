import { InstallPrompt } from "@/components/install-prompt.js";
import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { fmtMoneyPence } from "@/features/format.js";
import { oppositionName, played, type Game } from "@/features/games.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { useSession } from "@/lib/auth-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CalendarDaysIcon } from "lucide-react";
import { Link } from "react-router";

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
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">
          Hi {firstName}
        </h1>
        <p className="text-text-secondary text-sm">
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

  const count = countUnansweredDates(data);
  // Quiet — don't take up real estate when there's nothing to do.
  if (count === 0) return null;
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["charges", "outstanding"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load donations" />;

  const charges = data?.charges ?? [];
  const outstanding = charges.filter(
    (c) =>
      c.paid_at === null && c.deleted_at === null && c.relieved_at === null,
  );
  if (outstanding.length === 0) return null;
  const total = outstanding.reduce((acc, c) => acc + c.amount_pence, 0);
  const overdueCount = outstanding.filter(isOverdue).length;
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
        <div className="text-navy text-3xl font-bold tracking-[-0.02em] dark:text-white">
          {fmtMoneyPence(total)}
        </div>
        <p className="text-text-secondary mt-1 mb-3 text-sm">
          {outstanding.length} unpaid match{" "}
          {outstanding.length === 1 ? "donation" : "donations"}
        </p>
        <Button asChild tone="primary" className="w-full">
          <a
            href={mainSiteUrl("/members?tab=payments")}
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
    queryKey: ["games"],
    queryFn: () => callApi(api.GET("/api/games")),
  });
  if (isLoading) return <CardSkeleton />;
  if (isError) return <CardError label="Couldn't load fixtures" />;

  const games = data ?? [];
  const today = todayMidnight();
  const upcoming = games
    .filter((g) => !played(g) && new Date(g.matchDate) >= today)
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate))
    .slice(0, 3);
  if (upcoming.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardEyebrow>Upcoming fixtures</CardEyebrow>
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
    .sort((a, b) => b.matchDate.localeCompare(a.matchDate))
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

function FixtureRow({ game }: { game: Game }) {
  const d = new Date(game.matchDate);
  const day = d.getDate();
  const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
  return (
    <Link
      to={`/fixture/${game.id}`}
      className="border-border-light grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t py-2.5 first:border-t-0"
    >
      <div className="bg-surface-raised flex flex-col items-center justify-center rounded-md py-1">
        <div className="text-navy text-base leading-none font-bold dark:text-white">
          {day}
        </div>
        <div className="text-text-secondary text-[10px] tracking-wide uppercase">
          {dayName}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight font-medium">
          vs {oppositionName(game)}
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
  if (o === "W")
    return (
      <StatusPill tone="success">{game.scoreDescription ?? "W"}</StatusPill>
    );
  if (o === "L")
    return (
      <StatusPill tone="danger">{game.scoreDescription ?? "L"}</StatusPill>
    );
  if (o === "D" || o === "T")
    return <StatusPill tone="warning">{game.scoreDescription ?? o}</StatusPill>;
  return <StatusPill tone="neutral">{o ?? "—"}</StatusPill>;
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

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isOverdue(c: Charge): boolean {
  if (!c.created_at) return false;
  const created = new Date(c.created_at);
  const days = (Date.now() - created.getTime()) / 86_400_000;
  return days > 14;
}
