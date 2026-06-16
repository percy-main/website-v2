import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { EventMetadata } from "./index.ts";
import { RRule } from "./rrule-compat.ts";

/**
 * Recurring-event expansion — the single source of truth shared by every
 * consumer (calendar month, event detail, home "What's On", and the admin
 * editor preview).
 *
 * Events store an iCal RRULE body in metadata.recurrence; `when` is the
 * series DTSTART and each occurrence keeps the same finish-minus-when
 * duration. Authors cancel individual dates via metadata.recurrence.exceptions
 * (Europe/London yyyy-MM-dd calendar dates).
 *
 * DST correctness is the tricky part: "every Tuesday 18:00 London" must stay
 * 18:00 across the BST/GMT switch, so we never let rrule.js generate at a
 * fixed UTC instant. Instead we generate in a *floating* space (the rule's
 * wall-clock, carried in the UTC fields of throwaway Dates) and re-localize
 * each instance back to a real instant in Europe/London.
 */

export const EVENT_TIME_ZONE = "Europe/London";

export interface Occurrence {
  /** Real instant, ISO-8601 with offset. */
  start: string;
  /** Real instant, ISO-8601 with offset. Present iff the event has a finish. */
  finish?: string;
  /** Europe/London calendar date (yyyy-MM-dd) — keys, links, exception match. */
  date: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** London calendar date (yyyy-MM-dd) of a real instant. */
function londonDate(instant: Date): string {
  return formatInTimeZone(instant, EVENT_TIME_ZONE, "yyyy-MM-dd");
}

/**
 * A real instant -> a throwaway Date whose UTC fields hold the instant's
 * London wall-clock. This is the "floating" representation rrule.js operates
 * on (it reads getUTC* with no tzid).
 */
function toFloating(instant: Date): Date {
  const [y, mo, d, h, mi, s] = formatInTimeZone(
    instant,
    EVENT_TIME_ZONE,
    "yyyy-MM-dd-HH-mm-ss",
  )
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/**
 * A floating instance produced by rrule.js -> the real instant of that
 * wall-clock in Europe/London.
 */
function fromFloating(floating: Date): Date {
  const wall =
    `${pad(floating.getUTCFullYear(), 4)}-${pad(floating.getUTCMonth() + 1)}-` +
    `${pad(floating.getUTCDate())} ${pad(floating.getUTCHours())}:` +
    `${pad(floating.getUTCMinutes())}:${pad(floating.getUTCSeconds())}`;
  return fromZonedTime(wall, EVENT_TIME_ZONE);
}

function buildRule(rruleBody: string, dtstart: Date) {
  return new RRule({ ...RRule.parseString(rruleBody), dtstart });
}

/**
 * Expand an event into concrete occurrences whose real start falls within
 * [from, to] (inclusive). Non-recurring events yield their single date if it
 * is in range; recurring events expand the RRULE, drop exception dates, and
 * sort ascending.
 */
export function expandEventOccurrences(
  meta: EventMetadata,
  range: DateRange,
): Occurrence[] {
  const when = new Date(meta.when);

  if (!meta.recurrence) {
    if (when < range.from || when > range.to) return [];
    return [
      {
        start: meta.when,
        ...(meta.finish ? { finish: meta.finish } : {}),
        date: londonDate(when),
      },
    ];
  }

  const durationMs = meta.finish
    ? new Date(meta.finish).getTime() - when.getTime()
    : undefined;
  const rule = buildRule(meta.recurrence.rrule, toFloating(when));
  const exceptions = new Set(meta.recurrence.exceptions ?? []);

  // Generate in the floating space over a buffered window (±1 day covers the
  // worst-case BST/GMT offset shift at the range edges), then re-localize.
  const floatingFrom = toFloating(new Date(range.from.getTime() - DAY_MS));
  const floatingTo = toFloating(new Date(range.to.getTime() + DAY_MS));

  const occurrences: Occurrence[] = [];
  for (const floating of rule.between(floatingFrom, floatingTo, true)) {
    const start = fromFloating(floating);
    if (start < range.from || start > range.to) continue;
    const date = londonDate(start);
    if (exceptions.has(date)) continue;
    occurrences.push({
      start: start.toISOString(),
      ...(durationMs !== undefined
        ? { finish: new Date(start.getTime() + durationMs).toISOString() }
        : {}),
      date,
    });
  }

  occurrences.sort((a, b) => a.start.localeCompare(b.start));
  return occurrences;
}

/** The first occurrence on or after `after`, within `horizonDays`. */
export function nextOccurrence(
  meta: EventMetadata,
  after: Date,
  horizonDays = 365,
): Occurrence | undefined {
  const to = new Date(after.getTime() + horizonDays * DAY_MS);
  return expandEventOccurrences(meta, { from: after, to })[0];
}

/** The occurrence falling on a given Europe/London calendar date, if any. */
export function occurrenceOnDate(
  meta: EventMetadata,
  date: string,
): Occurrence | undefined {
  const from = fromZonedTime(`${date} 00:00:00`, EVENT_TIME_ZONE);
  const to = fromZonedTime(`${date} 23:59:59`, EVENT_TIME_ZONE);
  return expandEventOccurrences(meta, { from, to }).find(
    (o) => o.date === date,
  );
}

/** The most recent occurrence strictly before `before`, within `lookbackDays`. */
export function latestOccurrenceBefore(
  meta: EventMetadata,
  before: Date,
  lookbackDays = 730,
): Occurrence | undefined {
  const from = new Date(before.getTime() - lookbackDays * DAY_MS);
  const occurrences = expandEventOccurrences(meta, { from, to: before });
  return occurrences[occurrences.length - 1];
}

/**
 * The occurrence the event-detail page should display: the one matching the
 * `on` query param if valid, else the next upcoming one, else the most recent
 * past one. Non-recurring events always resolve to their single date.
 */
export function viewedOccurrence(
  meta: EventMetadata,
  options: { on?: string | null; now: Date },
): Occurrence | undefined {
  if (!meta.recurrence) {
    return {
      start: meta.when,
      ...(meta.finish ? { finish: meta.finish } : {}),
      date: londonDate(new Date(meta.when)),
    };
  }
  if (options.on && /^\d{4}-\d{2}-\d{2}$/.test(options.on)) {
    const match = occurrenceOnDate(meta, options.on);
    if (match) return match;
  }
  return (
    nextOccurrence(meta, options.now) ??
    latestOccurrenceBefore(meta, options.now)
  );
}

/** Human-readable recurrence summary, e.g. "every week on Tuesday". */
export function recurrenceSummary(meta: EventMetadata): string | undefined {
  if (!meta.recurrence) return undefined;
  try {
    return buildRule(
      meta.recurrence.rrule,
      toFloating(new Date(meta.when)),
    ).toText();
  } catch {
    return undefined;
  }
}
