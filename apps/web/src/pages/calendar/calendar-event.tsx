import { ContentBody } from "@/components/content-body.js";
import { Map } from "@/components/map.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import {
  eventQueryOptions,
  parseEventMetadata,
} from "@/lib/content-queries.js";
import {
  expandEventOccurrences,
  recurrenceSummary,
  viewedOccurrence,
} from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import { AddToCalendarButton } from "add-to-calendar-button-react";
import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";
import { IoCalendar, IoChevronForward } from "react-icons/io5";
import { Link, useParams, useSearchParams } from "react-router";

function When({ start, end }: { start: string; end?: string }) {
  return (
    <div className="border-primary bg-surface text-primary flex flex-row items-center justify-between gap-4 border-2 p-4">
      <IoCalendar fontSize={32} />
      <div className="flex flex-col gap-4">
        <p>
          <span className="font-semibold">Start: </span>
          {formatInTimeZone(
            new Date(start),
            "Europe/London",
            "dd/MM/yyyy HH:mm",
          )}
        </p>
        {end && (
          <p>
            <span className="font-semibold">Finish: </span>
            {formatInTimeZone(
              new Date(end),
              "Europe/London",
              "dd/MM/yyyy HH:mm",
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Venue display fields, embedded inline in the event's metadata
 * (name/street/city/postcode - no county/country, a deliberate trim).
 */
interface EventVenue {
  name: string;
  street?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
  postcode?: string | null;
  lat?: number | null;
  lon?: number | null;
}

function EventLayout({
  name,
  when,
  finish,
  venue,
  repeats,
  upcoming,
  children,
}: {
  name: string;
  when: string;
  finish?: string;
  venue?: EventVenue;
  repeats?: string;
  upcoming?: Array<{ date: string; href: string; label: string }>;
  children: ReactNode;
}) {
  const year = formatInTimeZone(new Date(when), "Europe/London", "yyyy");
  const month = formatInTimeZone(new Date(when), "Europe/London", "MMMM");

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-muted">
          Calendar
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        <Link
          to={`/calendar/${year}/${month.toLowerCase()}`}
          className="hover:text-primary text-muted"
        >
          {month} {year}
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        <span className="fc-two-tone font-medium">{name}</span>
      </div>

      <div className="flex flex-col items-start gap-4">
        <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2 md:gap-4">
          {children}
          <div className="flex flex-row flex-wrap items-center gap-2 md:gap-4">
            <AddToCalendarButton
              hideBranding
              name={name}
              options={[
                "Apple",
                "Google",
                "iCal",
                "Microsoft365",
                "MicrosoftTeams",
                "Outlook.com",
                "Yahoo",
              ]}
              location={venue?.name}
              startDate={formatInTimeZone(
                new Date(when),
                "Europe/London",
                "yyyy-MM-dd",
              )}
              endDate={
                finish
                  ? formatInTimeZone(
                      new Date(finish),
                      "Europe/London",
                      "yyyy-MM-dd",
                    )
                  : undefined
              }
              startTime={formatInTimeZone(
                new Date(when),
                "Europe/London",
                "HH:mm",
              )}
              endTime={
                finish
                  ? formatInTimeZone(new Date(finish), "Europe/London", "HH:mm")
                  : undefined
              }
              timeZone="Europe/London"
              hideRichData
            />
            <When start={when} end={finish} />
          </div>
        </div>

        {repeats && (
          <div className="border-primary bg-surface text-primary flex w-full flex-col gap-2 border-2 p-4">
            <p>
              <span className="font-semibold">Repeats: </span>
              {repeats}
            </p>
            {upcoming && upcoming.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-semibold">Upcoming dates</span>
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {upcoming.map((o) => (
                    <li key={o.date}>
                      <Link
                        to={o.href}
                        className="hover:text-cta text-muted hover:underline"
                      >
                        {o.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {venue?.lat != null && venue?.lon != null && (
        <Map
          center={{ lat: venue.lat, lon: venue.lon }}
          infoWindow={{ header: venue.name }}
        >
          <div className="border-primary bg-surface text-primary flex flex-col gap-2 border-2 p-4 text-lg sm:text-sm">
            <h4 className="text-h6 md:text-h5">{venue.name}</h4>
            {venue.street && <p>{venue.street}</p>}
            {venue.city && <p>{venue.city}</p>}
            {venue.county && <p>{venue.county}</p>}
            {venue.country && <p>{venue.country}</p>}
            {venue.postcode && <p>{venue.postcode}</p>}
          </div>
        </Map>
      )}
    </div>
  );
}

export function Component() {
  const { id } = useParams<{ id: string }>();
  const slug = id ?? "";
  const [searchParams] = useSearchParams();
  const on = searchParams.get("on");

  const {
    data: apiEvent,
    isPending,
    isError,
  } = useQuery(eventQueryOptions(slug));

  const meta = apiEvent ? parseEventMetadata(apiEvent.metadata) : undefined;

  useDocumentMeta(apiEvent?.title ?? "Event");

  if (apiEvent && meta) {
    // Resolve which occurrence to show: the ?on date, else the next upcoming,
    // else the most recent past one. Non-recurring events resolve to their
    // single date. Add-to-calendar and the breadcrumb follow this occurrence.
    const now = new Date();
    const occ = viewedOccurrence(meta, { on, now }) ?? {
      start: meta.when,
      finish: meta.finish,
      date: formatInTimeZone(
        new Date(meta.when),
        "Europe/London",
        "yyyy-MM-dd",
      ),
    };
    const repeats = recurrenceSummary(meta);
    const upcoming = meta.recurrence
      ? expandEventOccurrences(meta, {
          from: now,
          to: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        })
          .slice(0, 8)
          .map((o) => ({
            date: o.date,
            href: `/calendar/event/${slug}?on=${o.date}`,
            label: formatInTimeZone(
              new Date(o.start),
              "Europe/London",
              "EEE d MMM",
            ),
          }))
      : undefined;

    return (
      <EventLayout
        name={apiEvent.title}
        when={occ.start}
        finish={occ.finish}
        venue={meta.location}
        repeats={repeats}
        upcoming={upcoming}
      >
        <ContentBody body={apiEvent.body} className="w-full" />
      </EventLayout>
    );
  }

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <PageLoading />
      </div>
    );
  }

  // The query returns null on a confirmed 404 and throws on anything
  // else - an API incident must not read as "this event doesn't exist".
  if (isError) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>We couldn&apos;t load this event</h1>
        <p>
          Something went wrong fetching this event. Please try again in a few
          minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="fc-two-tone text-2xl font-semibold">Event Not Found</h1>
      <p className="text-muted mt-2">This event could not be found.</p>
      <Link
        to="/calendar"
        className="text-primary mt-4 inline-block hover:underline"
      >
        Back to calendar
      </Link>
    </div>
  );
}
