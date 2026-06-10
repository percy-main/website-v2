import { ContentBody } from "@/components/content-body.js";
import { Map } from "@/components/map.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import {
  eventQueryOptions,
  parseEventMetadata,
} from "@/lib/content-queries.js";
import { getEventBySlug } from "@/lib/events.js";
import { getLocationByName } from "@/lib/locations.js";
import { MDXProvider } from "@mdx-js/react";
import { useQuery } from "@tanstack/react-query";
import { AddToCalendarButton } from "add-to-calendar-button-react";
import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";
import { IoCalendar, IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

function When({ start, end }: { start: string; end?: string }) {
  return (
    <div className="flex flex-row items-center justify-between gap-4 rounded-xl bg-white p-4">
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
 * Venue display fields. DB events embed the venue inline in metadata
 * (name/street/city/postcode only - no county/country, a deliberate
 * trim); the static fallback still resolves locations.yaml, which has
 * the two extra fields.
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
  children,
}: {
  name: string;
  when: string;
  finish?: string;
  venue?: EventVenue;
  children: ReactNode;
}) {
  const year = formatInTimeZone(new Date(when), "Europe/London", "yyyy");
  const month = formatInTimeZone(new Date(when), "Europe/London", "MMMM");

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-stone-600">
          Calendar
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <Link
          to={`/calendar/${year}/${month.toLowerCase()}`}
          className="hover:text-primary text-stone-600"
        >
          {month} {year}
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">{name}</span>
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
      </div>

      {venue?.lat != null && venue?.lon != null && (
        <Map
          center={{ lat: venue.lat, lon: venue.lon }}
          infoWindow={{ header: venue.name }}
        >
          <div className="flex flex-col gap-2 bg-white p-4 text-lg sm:text-sm">
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

  // DB-backed event first (live content editing, #489); the bundled MDX
  // corpus stays as fallback until the migration is verified in prod, then
  // gets deleted in a follow-up. The MDX renders only once the query
  // settles (confirmed 404, or an API failure - deliberate graceful
  // degradation) so a DB-edited event never flashes its stale MDX
  // ancestor first.
  const { data: apiEvent, isPending } = useQuery(eventQueryOptions(slug));
  const staticEvent = id ? getEventBySlug(id) : undefined;

  const meta = apiEvent ? parseEventMetadata(apiEvent.metadata) : undefined;

  useDocumentMeta(apiEvent?.title ?? staticEvent?.name ?? "Event");

  if (apiEvent && meta) {
    return (
      <EventLayout
        name={apiEvent.title}
        when={meta.when}
        finish={meta.finish}
        venue={meta.location}
      >
        <ContentBody body={apiEvent.body} />
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

  if (staticEvent) {
    const location = staticEvent.location
      ? getLocationByName(staticEvent.location)
      : undefined;
    const EventContent = staticEvent.Component;

    return (
      <EventLayout
        name={staticEvent.name}
        when={staticEvent.when}
        finish={staticEvent.finish}
        venue={
          location ??
          (staticEvent.location ? { name: staticEvent.location } : undefined)
        }
      >
        <MDXProvider components={mdxComponents}>
          <div className="mdx-content flex flex-col *:mb-4">
            <EventContent />
          </div>
        </MDXProvider>
      </EventLayout>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold">Event Not Found</h1>
      <p className="mt-2 text-stone-600">This event could not be found.</p>
      <Link
        to="/calendar"
        className="text-primary mt-4 inline-block hover:underline"
      >
        Back to calendar
      </Link>
    </div>
  );
}
