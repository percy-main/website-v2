import { OutcomeBadge } from "@/components/outcome-badge.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api } from "@/lib/api.js";
import { getAllEvents } from "@/lib/events.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isBefore,
  isToday,
  startOfMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useMemo, useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

// --- Types ---

type Outcome = "W" | "L" | "D" | "T" | "A" | "C" | "N";

type CalendarItem =
  | {
      id: string;
      type: "game";
      category: "1xi" | "2xi" | "mid" | "jun";
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
    };

type Filter = "all" | "1xi" | "2xi" | "mid" | "jun" | "event";

interface GameListItem {
  id: string;
  matchDate: string;
  matchTime: string | null;
  home: boolean;
  team: { id: string; name: string };
  opposition: {
    club: { id: string; name: string };
    team: { id: string; name: string };
  };
  league: { id: string; name: string };
  competition: { id: string; name: string; type: string };
  when: string | null;
  outcome: Outcome | null;
  scoreDescription: string | null;
  sponsorName: string | null;
}

// --- Constants ---

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const FILTER_LABELS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "1xi", label: "1st XI" },
  { key: "2xi", label: "2nd XI" },
  { key: "mid", label: "Midweek XI" },
  { key: "jun", label: "Juniors" },
  { key: "event", label: "Events" },
];

const TEAM_BORDER_CLASSES: Record<string, string> = {
  "1xi": "border-l-green-800",
  "2xi": "border-l-blue-600",
  mid: "border-l-violet-600",
  jun: "border-l-amber-600",
};

// --- Helpers ---

type TeamCategory = "1xi" | "2xi" | "mid" | "jun";

function categoriseTeam(teamName: string): TeamCategory {
  if (/1st/i.test(teamName)) return "1xi";
  if (/2nd/i.test(teamName)) return "2xi";
  if (/midweek/i.test(teamName)) return "mid";
  if (/under|junior|colts|\bU\d{2}\b/i.test(teamName)) return "jun";
  return "1xi";
}

function parseMonthYear(
  yearParam: string,
  monthParam: string,
): { year: number; monthIndex: number } | null {
  const year = parseInt(yearParam, 10);
  if (isNaN(year)) return null;
  const monthIndex = MONTH_NAMES.indexOf(monthParam.toLowerCase());
  if (monthIndex === -1) return null;
  return { year, monthIndex };
}

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
  const dayHeaders = ["M", "T", "W", "T", "F", "S", "S"];
  const daysInMonth = getDaysInMonth(date);
  const firstDayOfWeek = (getDay(startOfMonth(date)) + 6) % 7; // Mon=0

  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-bold text-gray-900">
        {format(date, "MMMM yyyy")}
      </div>
      <div className="mb-1 grid grid-cols-7 text-center">
        {dayHeaders.map((d, i) => (
          <div
            key={i}
            className="py-1 text-[11px] font-semibold tracking-wider text-gray-400 uppercase"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {cells.map((cell, i) => {
          if (cell.day === null) {
            return <span key={i} className="py-1.5 text-xs text-gray-300" />;
          }
          const day = cell.day;
          const hasItems = itemsByDay.has(day);
          const hasMultiple = (itemsByDay.get(day)?.length ?? 0) > 1;
          const isSelected = selectedDay === day;
          const cellDate = new Date(date.getFullYear(), date.getMonth(), day);
          const isTodayDay = isToday(cellDate);

          const classes = cn(
            "relative rounded py-1.5 text-xs transition-colors",
            !hasItems && "text-gray-500",
            hasItems &&
              "cursor-pointer font-semibold text-gray-900 hover:bg-green-50",
            isSelected && "!bg-green-800 !text-white",
            isTodayDay && !isSelected && "ring-1 ring-green-800/40",
          );

          const dot = hasItems && (
            <span
              className={cn(
                "mx-auto mt-0.5 block rounded-full",
                isSelected ? "bg-white" : "bg-green-800",
                hasMultiple ? "h-[5px] w-2 rounded-sm" : "h-[5px] w-[5px]",
              )}
            />
          );

          if (hasItems) {
            return (
              <button
                key={i}
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
            <span key={i} className={classes}>
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
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="mb-2 text-xs font-bold tracking-wider text-gray-400 uppercase">
        Month Summary
      </h4>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-green-50 p-2 text-center">
          <div className="text-lg font-bold text-green-700">{stats.won}</div>
          <div className="text-[10px] font-semibold text-green-600 uppercase">
            Won
          </div>
        </div>
        <div className="rounded-lg bg-red-50 p-2 text-center">
          <div className="text-lg font-bold text-red-700">{stats.lost}</div>
          <div className="text-[10px] font-semibold text-red-600 uppercase">
            Lost
          </div>
        </div>
        <div className="rounded-lg bg-gray-100 p-2 text-center">
          <div className="text-lg font-bold text-gray-600">
            {stats.upcoming}
          </div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase">
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
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-green-800 text-white shadow-md"
                : "border-2 border-gray-200 text-gray-700 hover:border-gray-300",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// --- Fixture Card ---

function FixtureCard({ item }: { item: CalendarItem & { type: "game" } }) {
  const when = new Date(item.when);
  const time = formatInTimeZone(when, "Europe/London", "HH:mm");
  const borderClass = TEAM_BORDER_CLASSES[item.category] ?? "";
  const hasResultStripe = item.outcome === "W" || item.outcome === "L";

  return (
    <Link
      to={`/calendar/game/${item.id}`}
      className={cn(
        "group relative mb-2 flex items-center gap-3 overflow-hidden rounded-lg border-l-4 bg-white p-3 shadow-sm transition-all hover:translate-x-1 hover:shadow-md sm:gap-4 sm:p-4",
        borderClass,
      )}
    >
      {hasResultStripe && (
        <span
          className={cn(
            "absolute top-0 right-0 bottom-0 w-[3px]",
            item.outcome === "W" ? "bg-green-600" : "bg-red-600",
          )}
        />
      )}

      <div className="flex shrink-0 flex-col items-center gap-1">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-xs font-extrabold",
            item.home
              ? "bg-green-100 text-green-800"
              : "bg-blue-100 text-blue-800",
          )}
        >
          {item.home ? "H" : "A"}
        </span>
        <span className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
          {time}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <span className="text-sm font-bold text-gray-900 sm:text-base">
            {item.teamName}
          </span>
          <span className="text-sm text-gray-400">vs.</span>
          <span className="text-sm font-semibold text-gray-900 sm:text-base">
            {item.oppositionClub} {item.oppositionTeam}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">
            {item.leagueName || item.competitionName}
          </span>
          {item.sponsorName && (
            <>
              <span className="mx-1 h-1 w-1 rounded-full bg-gray-200" />
              <span className="text-xs font-medium text-orange-600">
                Sponsored by {item.sponsorName}
              </span>
            </>
          )}
        </div>
      </div>

      {item.outcome && (
        <OutcomeBadge
          outcome={item.outcome}
          scoreDescription={item.scoreDescription ?? undefined}
        />
      )}

      <IoChevronForward className="h-5 w-5 shrink-0 text-gray-300" />
    </Link>
  );
}

// --- Event Card ---

function EventCard({ item }: { item: CalendarItem & { type: "event" } }) {
  const when = new Date(item.when);
  const time = formatInTimeZone(when, "Europe/London", "HH:mm");

  return (
    <Link
      to={`/calendar/event/${item.id}`}
      className="group mb-2 flex items-center gap-3 rounded-lg border-2 border-dashed border-orange-300/50 bg-orange-50/50 p-3 transition-all hover:translate-x-1 hover:shadow-md sm:gap-4 sm:p-4"
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-100 text-orange-600">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </span>
        <span className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
          {time}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-orange-600 uppercase">
            Event
          </span>
          <span className="text-sm font-bold text-gray-900 sm:text-base">
            {item.eventName}
          </span>
        </div>
      </div>

      <IoChevronForward className="h-5 w-5 shrink-0 text-gray-300" />
    </Link>
  );
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
    <div className="mb-6" id={`agenda-day-${date.getDate()}`}>
      <div className="mb-3">
        <h3 className="mb-0 text-base font-bold text-gray-900 sm:text-lg">
          {heading}
        </h3>
      </div>
      {items.map((item) =>
        item.type === "event" ? (
          <EventCard key={item.id} item={item} />
        ) : (
          <FixtureCard key={item.id} item={item} />
        ),
      )}
    </div>
  );
}

// --- Past / Upcoming Divider ---

function PastUpcomingDivider() {
  return (
    <div className="relative my-8 flex items-center">
      <div className="flex-1 border-t-2 border-dashed border-green-800/20" />
      <span className="mx-4 shrink-0 rounded-full bg-green-800 px-4 py-1 text-xs font-bold tracking-wider text-white uppercase">
        Upcoming
      </span>
      <div className="flex-1 border-t-2 border-dashed border-green-800/20" />
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

  const date = useMemo(
    () => (parsed ? new Date(parsed.year, parsed.monthIndex, 1) : new Date()),
    [parsed],
  );
  const season = parsed?.year ?? new Date().getFullYear();

  const { data: games } = useQuery<GameListItem[]>({
    queryKey: ["games", season],
    queryFn: () => api.get(`/games?season=${season}`),
    staleTime: 5 * 60 * 1000,
  });

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
  const allItems = useMemo((): CalendarItem[] => {
    const items: CalendarItem[] = [];

    // Add games for this month
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

    // Add events for this month
    const events = getAllEvents();
    for (const event of events) {
      const eventDate = new Date(event.when);
      if (
        eventDate.getFullYear() !== date.getFullYear() ||
        eventDate.getMonth() !== date.getMonth()
      )
        continue;

      items.push({
        id: event.slug,
        type: "event",
        category: "event",
        when: event.when,
        eventName: event.name,
      });
    }

    // Sort by date, then games before events on same day
    items.sort((a, b) => {
      const diff = new Date(a.when).getTime() - new Date(b.when).getTime();
      if (diff !== 0) return diff;
      if (a.type === "game" && b.type === "event") return -1;
      if (a.type === "event" && b.type === "game") return 1;
      return 0;
    });

    return items;
  }, [games, date]);

  // Filter
  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return allItems;
    return allItems.filter((item) => item.category === activeFilter);
  }, [allItems, activeFilter]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of filteredItems) {
      const dateStr = item.when.split("T")[0];
      const existing = map.get(dateStr);
      if (existing) {
        existing.push(item);
      } else {
        map.set(dateStr, [item]);
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, items]) => ({ dateStr, items }));
  }, [filteredItems]);

  // Items by day number for mini calendar
  const itemsByDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of allItems) {
      const d = new Date(item.when).getDate();
      const existing = map.get(d);
      if (existing) {
        existing.push(item);
      } else {
        map.set(d, [item]);
      }
    }
    return map;
  }, [allItems]);

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const won = allItems.filter(
      (i) => i.type === "game" && i.outcome === "W",
    ).length;
    const lost = allItems.filter(
      (i) => i.type === "game" && i.outcome === "L",
    ).length;
    const upcoming = allItems.filter(
      (i) =>
        i.type === "game" && !i.outcome && !isBefore(new Date(i.when), now),
    ).length;
    return { won, lost, upcoming };
  }, [allItems]);

  // Divider position
  const dividerIndex = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let lastPastIdx = -1;
    for (let i = 0; i < grouped.length; i++) {
      const d = new Date(grouped[i].dateStr);
      if (d < today) lastPastIdx = i;
    }
    if (lastPastIdx >= 0 && lastPastIdx < grouped.length - 1) {
      return lastPastIdx;
    }
    return -1;
  }, [grouped]);

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
        <h1 className="text-2xl font-bold">Invalid Date</h1>
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
        <Link to="/calendar" className="hover:text-primary text-gray-600">
          Calendar
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <span className="text-dark font-medium">
          {monthDisplay} {yearDisplay}
        </span>
      </div>

      {/* Month Navigation Header */}
      <div className="mb-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link
            to={prevPath}
            className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-green-800/20 text-green-800 transition-colors hover:bg-green-800 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="mb-0 text-2xl font-bold text-gray-900 sm:text-3xl">
              {monthDisplay} {yearDisplay}
            </h1>
            <p className="text-sm text-gray-500">
              {totalFixtures} fixture{totalFixtures !== 1 ? "s" : ""}
              {totalResults > 0 && (
                <>
                  {" "}
                  &middot; {totalResults} result
                  {totalResults !== 1 ? "s" : ""}
                </>
              )}
            </p>
          </div>
          <Link
            to={nextPath}
            className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-green-800/20 text-green-800 transition-colors hover:bg-green-800 hover:text-white"
          >
            <svg
              className="h-5 w-5"
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
          className="hidden items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 sm:flex"
        >
          <svg
            className="h-4 w-4"
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

      {/* Filter Pills */}
      <FilterPills active={activeFilter} onChange={handleFilterChange} />

      {/* Main Content: Sidebar + Agenda */}
      <div className="flex gap-6 lg:gap-8">
        {/* Left Sidebar: Mini Calendar (desktop only) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-4 space-y-4">
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
            <div className="flex flex-col items-center justify-center rounded-lg bg-white p-8 text-center shadow-sm">
              <svg
                className="mb-3 h-12 w-12 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium text-gray-600">
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
