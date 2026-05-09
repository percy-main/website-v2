import { OutcomeBadge } from "@/components/outcome-badge.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { getAllEvents } from "@/lib/events.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isToday,
  startOfMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";
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

// --- Constants ---

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
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-bold text-stone-900">
        {format(date, "MMMM yyyy")}
      </div>
      <div className="mb-1 grid grid-cols-7 text-center">
        {dayHeaders.map((d) => (
          <div
            key={d.key}
            className="py-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase"
          >
            {d.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {cells.map((cell) => {
          if (cell.day === null) {
            return (
              <span key={cell.key} className="py-1.5 text-xs text-stone-300" />
            );
          }
          const day = cell.day;
          const hasItems = itemsByDay.has(day);
          const hasMultiple = (itemsByDay.get(day)?.length ?? 0) > 1;
          const isSelected = selectedDay === day;
          const cellDate = new Date(date.getFullYear(), date.getMonth(), day);
          const isTodayDay = isToday(cellDate);

          const classes = cn(
            "relative rounded py-1.5 text-xs transition-colors",
            !hasItems && "text-stone-500",
            hasItems &&
              "cursor-pointer font-semibold text-stone-900 hover:bg-green-50",
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
    <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h4 className="mb-2 text-xs font-semibold tracking-wider text-stone-400 uppercase">
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
        <div className="rounded-lg bg-stone-100 p-2 text-center">
          <div className="text-lg font-bold text-stone-600">
            {stats.upcoming}
          </div>
          <div className="text-[10px] font-semibold text-stone-400 uppercase">
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
                : "border-2 border-stone-200 text-stone-700 hover:border-stone-300",
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
            "flex size-7 items-center justify-center rounded-md text-xs font-semibold",
            item.home
              ? "bg-green-100 text-green-800"
              : "bg-blue-100 text-blue-800",
          )}
        >
          {item.home ? "H" : "A"}
        </span>
        <span className="text-[10px] font-bold tracking-wider text-stone-400 uppercase">
          {time}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <span className="text-sm font-bold text-stone-900 sm:text-base">
            {item.teamName}
          </span>
          <span className="text-sm text-stone-400">vs.</span>
          <span className="text-sm font-semibold text-stone-900 sm:text-base">
            {item.oppositionClub} {item.oppositionTeam}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-400">
            {item.leagueName || item.competitionName}
          </span>
          {item.sponsorName && (
            <>
              <span className="mx-1 size-1 rounded-full bg-stone-200" />
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

      <IoChevronForward className="size-5 shrink-0 text-stone-300" />
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
        <span className="flex size-7 items-center justify-center rounded-md bg-orange-100 text-orange-600">
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </span>
        <span className="text-[10px] font-bold tracking-wider text-stone-400 uppercase">
          {time}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-orange-600 uppercase">
            Event
          </span>
          <span className="text-sm font-bold text-stone-900 sm:text-base">
            {item.eventName}
          </span>
        </div>
      </div>

      <IoChevronForward className="size-5 shrink-0 text-stone-300" />
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
        <h3 className="mb-0 text-base font-semibold text-stone-900 sm:text-lg">
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

    return sortCalendarItems(items);
  })();

  const filteredItems = filterItemsByCategory(allItems, activeFilter);
  const grouped = groupItemsByDate(filteredItems);
  const itemsByDay = groupItemsByDay(allItems);
  const stats = summariseMonth(allItems, new Date());
  const dividerIndex = findDividerIndex(grouped, new Date());

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
        <Link to="/calendar" className="hover:text-primary text-stone-600">
          Calendar
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">
          {monthDisplay} {yearDisplay}
        </span>
      </div>

      {/* Month Navigation Header */}
      <div className="mb-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link
            to={prevPath}
            className="flex size-10 items-center justify-center rounded-lg border-2 border-green-800/20 text-green-800 transition-colors hover:bg-green-800 hover:text-white"
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
            <h1 className="mb-0 text-2xl font-semibold text-stone-900 sm:text-3xl">
              {monthDisplay} {yearDisplay}
            </h1>
            <p className="text-sm text-stone-500">
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
            className="flex size-10 items-center justify-center rounded-lg border-2 border-green-800/20 text-green-800 transition-colors hover:bg-green-800 hover:text-white"
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
          className="hidden items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 sm:flex"
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
                className="mb-3 size-12 text-stone-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium text-stone-600">
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
