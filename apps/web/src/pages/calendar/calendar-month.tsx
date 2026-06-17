import { Kicker } from "@/components/theme/bits.js";
import {
  FixtureStrip,
  type FixtureStripItem,
} from "@/components/theme/fixture-strip.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import {
  eventsListQueryOptions,
  parseEventMetadata,
} from "@/lib/content-queries.js";
import { cn } from "@/lib/utils.js";
import { expandEventOccurrences } from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  format,
  getDay,
  getDaysInMonth,
  isToday,
  startOfMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  categoriseTeam,
  filterItemsByCategory,
  findDividerIndex,
  groupItemsByDate,
  groupItemsByDay,
  parseMonthYear,
  sortCalendarItems,
  summariseMonth,
  type Filter,
} from "./calendar-month.lib.js";

// --- Types ---

type GameListItem =
  paths["/api/games"]["get"]["responses"]["200"]["content"]["application/json"][number];

type Outcome = NonNullable<GameListItem["outcome"]>;

type CalendarItem =
  | {
      id: string;
      type: "game";
      category: "1xi" | "2xi" | "mid" | "wxi" | "jun";
      when: string;
      home: boolean;
      teamName: string;
      oppositionClub: string;
      oppositionTeam: string;
      leagueName: string;
      competitionName: string;
      sponsorName: string | null;
      outcome: Outcome | null;
      scoreDescription: string | null;
    }
  | {
      id: string;
      type: "event";
      category: "event";
      when: string;
      eventName: string;
      slug: string;
      occurrenceDate: string;
    };

// --- Constants ---

const FILTER_LABELS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "1xi", label: "1st XI" },
  { key: "2xi", label: "2nd XI" },
  { key: "mid", label: "Midweek XI" },
  { key: "wxi", label: "Women's XI" },
  { key: "jun", label: "Juniors" },
  { key: "event", label: "Events" },
];

const OUTCOME_LABELS: Record<Outcome, string> = {
  W: "Won",
  L: "Lost",
  D: "Draw",
  T: "Tied",
  A: "Abandoned",
  C: "Cancelled",
  N: "No result",
};

// --- Mini Calendar ---

function MiniCalendar({
  date,
  itemsByDay,
  selectedDay,
  onDayClick,
}: {
  date: Date;
  itemsByDay: Map<number, CalendarItem[]>;
  selectedDay: number | null;
  onDayClick: (day: number) => void;
}) {
  const dayHeaders: Array<{ key: string; label: string }> = [
    { key: "mon", label: "M" },
    { key: "tue", label: "T" },
    { key: "wed", label: "W" },
    { key: "thu", label: "T" },
    { key: "fri", label: "F" },
    { key: "sat", label: "S" },
    { key: "sun", label: "S" },
  ];
  const daysInMonth = getDaysInMonth(date);
  const firstDayOfWeek = (getDay(startOfMonth(date)) + 6) % 7; // Mon=0

  const cells: Array<{ key: string; day: number | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++)
    cells.push({ key: `pad-${i}`, day: null });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ key: `day-${d}`, day: d });

  return (
    <div className="border-primary bg-surface border-2 p-4">
      <div className="text-primary mb-3 text-sm font-bold">
        {format(date, "MMMM yyyy")}
      </div>
      <div className="mb-1 grid grid-cols-7 text-center">
        {dayHeaders.map((d) => (
          <div
            key={d.key}
            className="text-muted py-1 text-[11px] font-semibold tracking-wider uppercase"
          >
            {d.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {cells.map((cell) => {
          if (cell.day === null) {
            return (
              <span key={cell.key} className="text-muted/40 py-1.5 text-xs" />
            );
          }
          const day = cell.day;
          const hasItems = itemsByDay.has(day);
          const hasMultiple = (itemsByDay.get(day)?.length ?? 0) > 1;
          const isSelected = selectedDay === day;
          const cellDate = new Date(date.getFullYear(), date.getMonth(), day);
          const isTodayDay = isToday(cellDate);

          const classes = cn(
            "relative py-1.5 text-xs transition-colors",
            !hasItems && "text-muted",
            hasItems &&
              "text-primary hover:bg-primary/10 cursor-pointer font-semibold",
            isSelected && "!bg-primary !text-paper",
            isTodayDay && !isSelected && "ring-primary/40 ring-1",
          );

          const dot = hasItems && (
            <span
              className={cn(
                "mx-auto mt-0.5 block rounded-full",
                isSelected ? "bg-paper" : "bg-cta",
                hasMultiple ? "h-[5px] w-2 rounded-sm" : "h-[5px] w-[5px]",
              )}
            />
          );

          if (hasItems) {
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onDayClick(day)}
                className={classes}
              >
                {day}
                {dot}
              </button>
            );
          }

          return (
            <span key={cell.key} className={classes}>
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// --- Month Summary ---

function MonthSummary({
  stats,
}: {
  stats: { won: number; lost: number; upcoming: number };
}) {
  return (
    <div className="border-primary bg-surface mt-4 border-2 p-4">
      <h4 className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
        Month Summary
      </h4>
      <div className="grid grid-cols-3 gap-2">
        <div className="border-border bg-surface border p-2 text-center">
          <div className="text-primary text-lg font-bold">{stats.won}</div>
          <div className="text-primary text-[10px] font-semibold uppercase">
            Won
          </div>
        </div>
        <div className="border-border bg-surface border p-2 text-center">
          <div className="text-lg font-bold text-red-700">{stats.lost}</div>
          <div className="text-[10px] font-semibold text-red-700 uppercase">
            Lost
          </div>
        </div>
        <div className="border-border bg-surface border p-2 text-center">
          <div className="text-cta text-lg font-bold">{stats.upcoming}</div>
          <div className="text-cta text-[10px] font-semibold uppercase">
            Upcoming
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Filter Pills ---

function FilterPills({
  active,
  onChange,
}: {
  active: Filter;
  onChange: (f: Filter) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap justify-center gap-2 sm:justify-start">
      {FILTER_LABELS.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-paper"
                : "border-border text-muted hover:border-primary border-2",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// --- Month Navigation Header ---

function MonthNavHeader({
  prevPath,
  nextPath,
  todayPath,
  monthDisplay,
  yearDisplay,
  totalFixtures,
  totalResults,
  isCurrentMonth,
  onToday,
}: {
  prevPath: string;
  nextPath: string;
  todayPath: string;
  monthDisplay: string;
  yearDisplay: string;
  totalFixtures: number;
  totalResults: number;
  isCurrentMonth: boolean;
  onToday: () => void;
}) {
  return (
    <div className="mb-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-4 sm:gap-8">
        <Link
          to={prevPath}
          className="border-primary text-primary hover:bg-primary hover:text-paper flex size-10 items-center justify-center border-2 transition-colors"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="fc-two-tone mb-0 text-2xl font-semibold sm:text-3xl">
            {monthDisplay} {yearDisplay}
          </h1>
          <p className="text-muted text-sm">
            {totalFixtures} fixture{totalFixtures !== 1 ? "s" : ""}
            {totalResults > 0 && (
              <>
                {" "}
                &middot; {totalResults} result{totalResults !== 1 ? "s" : ""}
              </>
            )}
          </p>
        </div>
        <Link
          to={nextPath}
          className="border-primary text-primary hover:bg-primary hover:text-paper flex size-10 items-center justify-center border-2 transition-colors"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      <Link
        to={todayPath}
        state={{ scrollToToday: true }}
        onClick={(e) => {
          // Already on the current month: no navigation needed, just scroll
          // the agenda to today. Other months fall through to the Link's
          // navigation, and the effect scrolls once it lands.
          if (isCurrentMonth) {
            e.preventDefault();
            onToday();
          }
        }}
        className="border-primary text-primary hover:bg-primary hover:text-paper hidden items-center gap-1.5 border-2 px-4 py-2 text-sm font-semibold transition sm:flex"
      >
        <svg
          className="size-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Today
      </Link>
    </div>
  );
}

// --- Fixture strip mapping ---

/**
 * Map a calendar item (game or event) into a poster fixture-strip row. Games
 * link to the game page with a Home/Away tag; events link to the event page
 * with an "Event" tag. The result word (W/L/D ...) and any sponsor note ride
 * along in the meta line so the strip stays a single, consistent voice.
 */
function toFixtureStripItem(item: CalendarItem): FixtureStripItem {
  const time = formatInTimeZone(new Date(item.when), "Europe/London", "HH:mm");

  // The day heading already prints the date, so the row's left block carries
  // the time instead (no duplicated date), and the time is dropped from meta.
  if (item.type === "event") {
    return {
      id: item.id,
      href: `/calendar/event/${item.slug}?on=${item.occurrenceDate}`,
      when: item.when,
      lead: time,
      title: item.eventName,
      tag: "Event",
    };
  }

  const competition = item.leagueName || item.competitionName;
  const outcomeLabel = item.outcome
    ? (OUTCOME_LABELS[item.outcome] ?? null)
    : null;

  return {
    id: item.id,
    href: `/calendar/game/${item.id}`,
    when: item.when,
    lead: time,
    title: (
      <>
        {item.teamName} vs {item.oppositionClub} {item.oppositionTeam}
      </>
    ),
    meta: (
      <>
        {competition}
        {outcomeLabel ? ` · ${outcomeLabel}` : ""}
        {item.scoreDescription ? ` · ${item.scoreDescription}` : ""}
        {item.sponsorName ? ` · Sponsored by ${item.sponsorName}` : ""}
      </>
    ),
    tag: item.home ? "Home" : "Away",
  };
}

// --- Date Group ---

function DateGroup({
  dateStr,
  items,
}: {
  dateStr: string;
  items: CalendarItem[];
}) {
  const date = new Date(dateStr);
  const heading = format(date, "EEEE d MMMM");

  return (
    <div className="mb-8 scroll-mt-24" id={`agenda-day-${date.getDate()}`}>
      <div className="mb-2">
        <Kicker level={3}>{heading}</Kicker>
      </div>
      <FixtureStrip items={items.map(toFixtureStripItem)} />
    </div>
  );
}

// --- Past / Upcoming Divider ---

function PastUpcomingDivider() {
  return (
    <div className="relative my-8 flex items-center">
      <div className="border-primary/30 flex-1 border-t-2 border-dashed" />
      <span className="bg-cta text-paper mx-4 shrink-0 px-4 py-1 text-xs font-bold tracking-wider uppercase">
        Upcoming
      </span>
      <div className="border-primary/30 flex-1 border-t-2 border-dashed" />
    </div>
  );
}

// --- Main Component ---

export function Component() {
  const { year: yearParam, month: monthParam } = useParams<{
    year: string;
    month: string;
  }>();

  const parsed =
    yearParam && monthParam ? parseMonthYear(yearParam, monthParam) : null;

  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const locationPathname = location.pathname;
  const locationState: unknown = location.state;

  const date = parsed
    ? new Date(parsed.year, parsed.monthIndex, 1)
    : new Date();
  const season = parsed?.year ?? new Date().getFullYear();

  const { data: games } = useQuery({
    queryKey: ["games", season],
    queryFn: () =>
      callApi(api.GET("/api/games", { params: { query: { season } } })),
    staleTime: 5 * 60 * 1000,
  });

  // DB-backed events (live content editing, #489).
  const { data: eventsData } = useQuery(eventsListQueryOptions());

  const handleFilterChange = (f: Filter) => {
    setActiveFilter(f);
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    const el = document.getElementById(`agenda-day-${day}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Build calendar items: merge games (from API) + events (from MDX)
  const allItems: CalendarItem[] = (() => {
    const items: CalendarItem[] = [];

    if (games) {
      for (const game of games) {
        if (!game.when) continue;
        const gameDate = new Date(game.when);
        if (
          gameDate.getFullYear() !== date.getFullYear() ||
          gameDate.getMonth() !== date.getMonth()
        )
          continue;

        items.push({
          id: game.id,
          type: "game",
          category: categoriseTeam(game.team.name),
          when: game.when,
          home: game.home,
          teamName: game.team.name,
          oppositionClub: game.opposition.club.name,
          oppositionTeam: game.opposition.team.name,
          leagueName: game.league.name,
          competitionName: game.competition.name,
          sponsorName: game.sponsorName,
          outcome: game.outcome,
          scoreDescription: game.scoreDescription,
        });
      }
    }

    // Expand each event (recurring or not) into the concrete occurrences that
    // fall within the displayed month. Recurrence expansion is DST-correct and
    // skips cancelled dates; non-recurring events yield their single date.
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    for (const item of eventsData?.items ?? []) {
      const meta = parseEventMetadata(item.metadata);
      if (!meta) continue;
      for (const occ of expandEventOccurrences(meta, {
        from: monthStart,
        to: monthEnd,
      })) {
        items.push({
          id: `${item.slug}#${occ.date}`,
          type: "event",
          category: "event",
          // London-local ISO so the agenda groups it under the right day
          // (groupItemsByDate keys off the leading date portion of `when`).
          when: formatInTimeZone(
            new Date(occ.start),
            "Europe/London",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
          ),
          eventName: item.title,
          slug: item.slug,
          occurrenceDate: occ.date,
        });
      }
    }

    return sortCalendarItems(items);
  })();

  const filteredItems = filterItemsByCategory(allItems, activeFilter);
  const grouped = groupItemsByDate(filteredItems);
  const itemsByDay = groupItemsByDay(allItems);
  const stats = summariseMonth(allItems, new Date());
  const dividerIndex = findDividerIndex(grouped, new Date());

  // "Today" scrolling. The day-of-month to land on is today itself if it has
  // fixtures, otherwise the next group on/after today (falling back to the
  // last group). Null when the displayed month is not the current month, or
  // before the agenda has rendered.
  const isCurrentMonth =
    date.getFullYear() === new Date().getFullYear() &&
    date.getMonth() === new Date().getMonth();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayTargetDay =
    isCurrentMonth && grouped.length > 0
      ? new Date(
          (
            grouped.find((g) => g.dateStr >= todayStr) ??
            grouped[grouped.length - 1]
          ).dateStr,
        ).getDate()
      : null;

  const scrollToToday = () => {
    if (todayTargetDay == null) return;
    document
      .getElementById(`agenda-day-${todayTargetDay}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Arriving via the Today button from another month: scroll once the agenda
  // for the current month has rendered, then clear the nav flag. Clearing the
  // flag (not a one-shot ref) is what stops a re-fire, so a later
  // "other month -> Today" on this still-mounted page scrolls again.
  const navState: unknown = locationState;
  const wantsTodayScroll =
    typeof navState === "object" &&
    navState !== null &&
    "scrollToToday" in navState &&
    navState.scrollToToday === true;
  useEffect(() => {
    if (!wantsTodayScroll || todayTargetDay == null) return;
    document
      .getElementById(`agenda-day-${todayTargetDay}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    void navigate(locationPathname, { replace: true, state: null });
  }, [wantsTodayScroll, todayTargetDay, navigate, locationPathname]);

  // Navigation
  const prevDate = addMonths(date, -1);
  const nextDate = addMonths(date, 1);
  const prevPath = `/calendar/${format(prevDate, "yyyy")}/${format(prevDate, "MMMM").toLowerCase()}`;
  const nextPath = `/calendar/${format(nextDate, "yyyy")}/${format(nextDate, "MMMM").toLowerCase()}`;
  const todayPath = `/calendar/${format(new Date(), "yyyy")}/${format(new Date(), "MMMM").toLowerCase()}`;

  const monthDisplay = format(date, "MMMM");
  const yearDisplay = format(date, "yyyy");

  useDocumentMeta(`Calendar — ${monthDisplay} ${yearDisplay}`);

  const totalFixtures = allItems.filter((i) => i.type === "game").length;
  const totalResults = allItems.filter(
    (i) => i.type === "game" && i.outcome,
  ).length;

  if (!parsed) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold">Invalid Date</h1>
        <Link
          to="/calendar"
          className="text-primary mt-4 inline-block hover:underline"
        >
          Back to calendar
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-muted">
          Calendar
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        <span className="text-primary font-medium">
          {monthDisplay} {yearDisplay}
        </span>
      </div>

      <MonthNavHeader
        prevPath={prevPath}
        nextPath={nextPath}
        todayPath={todayPath}
        monthDisplay={monthDisplay}
        yearDisplay={yearDisplay}
        totalFixtures={totalFixtures}
        totalResults={totalResults}
        isCurrentMonth={isCurrentMonth}
        onToday={scrollToToday}
      />

      {/* Filter Pills */}
      <FilterPills active={activeFilter} onChange={handleFilterChange} />

      {/* Main Content: Sidebar + Agenda */}
      <div className="flex gap-6 lg:gap-8">
        {/* Left Sidebar: Mini Calendar (desktop only) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          {/* Offset clears the sticky site header (top-0) so the pinned widget
              is not tucked underneath it. */}
          <div className="sticky top-20 space-y-4">
            <MiniCalendar
              date={date}
              itemsByDay={itemsByDay}
              selectedDay={selectedDay}
              onDayClick={handleDayClick}
            />
            {(stats.won > 0 || stats.lost > 0 || stats.upcoming > 0) && (
              <MonthSummary stats={stats} />
            )}
          </div>
        </aside>

        {/* Main Agenda */}
        <div className="min-w-0 flex-1">
          {grouped.length === 0 ? (
            <div className="border-primary bg-surface flex flex-col items-center justify-center border-2 p-8 text-center">
              <svg
                className="text-primary/30 mb-3 size-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-muted font-medium">
                {activeFilter === "all"
                  ? `No events scheduled for ${monthDisplay}`
                  : `No ${FILTER_LABELS.find((f) => f.key === activeFilter)?.label ?? ""} fixtures for ${monthDisplay}`}
              </p>
            </div>
          ) : (
            grouped.map((group, i) => (
              <div key={group.dateStr}>
                {dividerIndex >= 0 && dividerIndex === i - 1 && (
                  <PastUpcomingDivider />
                )}
                <DateGroup dateStr={group.dateStr} items={group.items} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
