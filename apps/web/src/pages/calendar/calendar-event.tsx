import { Map } from "@/components/map.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { getEventBySlug } from "@/lib/events.js";
import { getLocationByName } from "@/lib/locations.js";
import { MDXProvider } from "@mdx-js/react";
import { AddToCalendarButton } from "add-to-calendar-button-react";
import { formatInTimeZone } from "date-fns-tz";
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

export function Component() {
  const { id } = useParams<{ id: string }>();
  const event = id ? getEventBySlug(id) : undefined;

  useDocumentMeta(event?.name ?? "Event");

  if (!event) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold">Event Not Found</h1>
        <p className="mt-2 text-gray-600">This event could not be found.</p>
        <Link
          to="/calendar"
          className="text-primary mt-4 inline-block hover:underline"
        >
          Back to calendar
        </Link>
      </div>
    );
  }

  const location = event.location
    ? getLocationByName(event.location)
    : undefined;

  const year = formatInTimeZone(new Date(event.when), "Europe/London", "yyyy");
  const month = formatInTimeZone(new Date(event.when), "Europe/London", "MMMM");
  const EventContent = event.Component;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-gray-600">
          Calendar
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <Link
          to={`/calendar/${year}/${month.toLowerCase()}`}
          className="hover:text-primary text-gray-600"
        >
          {month} {year}
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        <span className="text-dark font-medium">{event.name}</span>
      </div>

      <div className="flex flex-col items-start gap-4">
        <div className="flex w-full flex-row flex-wrap items-center justify-between gap-2 md:gap-4">
          <MDXProvider components={mdxComponents}>
            <div className="mdx-content flex flex-col *:mb-4">
              <EventContent />
            </div>
          </MDXProvider>
          <div className="flex flex-row flex-wrap items-center gap-2 md:gap-4">
            <AddToCalendarButton
              hideBranding
              name={event.name}
              options={[
                "Apple",
                "Google",
                "iCal",
                "Microsoft365",
                "MicrosoftTeams",
                "Outlook.com",
                "Yahoo",
              ]}
              location={event.location}
              startDate={formatInTimeZone(
                new Date(event.when),
                "Europe/London",
                "yyyy-MM-dd",
              )}
              endDate={
                event.finish
                  ? formatInTimeZone(
                      new Date(event.finish),
                      "Europe/London",
                      "yyyy-MM-dd",
                    )
                  : undefined
              }
              startTime={formatInTimeZone(
                new Date(event.when),
                "Europe/London",
                "HH:mm",
              )}
              endTime={
                event.finish
                  ? formatInTimeZone(
                      new Date(event.finish),
                      "Europe/London",
                      "HH:mm",
                    )
                  : undefined
              }
              timeZone="Europe/London"
              hideRichData
            />
            <When start={event.when} end={event.finish} />
          </div>
        </div>
      </div>

      {location?.lat != null && location?.lon != null && (
        <Map
          center={{ lat: location.lat, lon: location.lon }}
          infoWindow={{ header: location.name }}
        >
          <div className="flex flex-col gap-2 bg-white p-4 text-lg sm:text-sm">
            <h4 className="text-h6 md:text-h5">{location.name}</h4>
            {location.street && <p>{location.street}</p>}
            {location.city && <p>{location.city}</p>}
            {location.county && <p>{location.county}</p>}
            {location.country && <p>{location.country}</p>}
            {location.postcode && <p>{location.postcode}</p>}
          </div>
        </Map>
      )}
    </div>
  );
}
