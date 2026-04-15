import { Map } from "@/components/map.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { OutcomeBadge } from "@/components/outcome-badge.js";
import { Scorecard } from "@/components/scorecard.js";
import { Badge } from "@/components/ui/badge.js";
import { buttonVariants } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { getGameReport } from "@/lib/game-reports.js";
import { getLocationByName } from "@/lib/locations.js";
import { cn } from "@/lib/utils.js";
import { MDXProvider } from "@mdx-js/react";
import { useQuery } from "@tanstack/react-query";
import { AddToCalendarButton } from "add-to-calendar-button-react";
import { isAfter } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect } from "react";
import { IoCalendar, IoChevronForward } from "react-icons/io5";
import { Link, useParams, useSearchParams } from "react-router";

type GameData =
  paths["/api/games/{matchId}"]["get"]["responses"]["200"]["content"]["application/json"];

// Strip the ?og=1 bypass param that CloudFront adds when redirecting
// through the OG meta tag page, so users don't reshare the bypass URL.
function useStripOgParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.has("og")) {
      searchParams.delete("og");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
}

function SponsorThisGame({ gameId, when }: { gameId: string; when: string }) {
  const isFuture = isAfter(new Date(when), new Date());

  const pendingQuery = useQuery({
    queryKey: ["game-sponsor-pending", gameId],
    queryFn: () =>
      callApi(
        api.GET("/api/sponsorship/game/{gameId}/pending", {
          params: { path: { gameId } },
        }),
      ),
    enabled: isFuture,
    staleTime: 30 * 1000,
  });

  if (!isFuture || pendingQuery.data?.hasPending) return null;

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
      <p className="text-sm text-orange-600">No match sponsor... yet</p>
      <Link
        to={`/calendar/game/${gameId}/sponsor`}
        className={buttonVariants({ variant: "default", size: "sm" })}
      >
        Sponsor This Game
      </Link>
    </div>
  );
}

function formatInningsScore(inn: {
  runs: number;
  wickets: number;
  overs: string;
  allOut: boolean;
  declared: boolean;
}): string {
  const wicketsPart = inn.allOut ? "" : `/${inn.wickets}`;
  const declaredPart = inn.declared ? " dec" : "";
  const oversPart = inn.overs ? ` (${inn.overs} ov)` : "";
  return `${inn.runs}${wicketsPart}${declaredPart}${oversPart}`;
}

function When({ start, end }: { start: string; end?: string }) {
  return (
    <div className="flex w-full flex-row items-center justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4 md:w-auto">
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

function ResultSummary({
  result,
}: {
  result: NonNullable<GameData["result"]>;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          {result.outcome && <OutcomeBadge outcome={result.outcome} />}
          {result.toss && (
            <span className="text-sm text-gray-600">{result.toss}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {result.innings.map((inn, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium">{inn.teamName}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatInningsScore(inn)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SponsorBadge({
  sponsor,
}: {
  sponsor: NonNullable<GameData["sponsor"]>;
}) {
  const content = (
    <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
      {sponsor.logoUrl && (
        <img
          src={sponsor.logoUrl}
          alt={sponsor.name}
          className="h-12 max-w-[120px] rounded object-contain"
        />
      )}
      <div className="text-center">
        <p className="text-xs text-orange-600">Match sponsored by</p>
        <p
          className={cn(
            "text-lg font-semibold text-orange-800",
            sponsor.website &&
              /^https?:\/\//i.test(sponsor.website) &&
              "underline decoration-dotted underline-offset-2",
          )}
        >
          {sponsor.name}
        </p>
      </div>
      {sponsor.message && (
        <p className="text-sm text-orange-600">{sponsor.message}</p>
      )}
    </div>
  );

  if (sponsor.website && /^https?:\/\//i.test(sponsor.website)) {
    return (
      <a
        href={sponsor.website}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:opacity-80"
      >
        {content}
      </a>
    );
  }

  return content;
}

function GameDetailContent({ game }: { game: GameData }) {
  const report = getGameReport(game.id);

  const title = `${game.team.name} vs. ${game.opposition.club.name} ${game.opposition.team.name} ${game.home ? "(H)" : "(A)"}`;

  const year = game.when
    ? formatInTimeZone(new Date(game.when), "Europe/London", "yyyy")
    : undefined;
  const month = game.when
    ? formatInTimeZone(new Date(game.when), "Europe/London", "MMMM")
    : undefined;

  // Estimate finish as 5 hours after start
  const finish = game.when
    ? new Date(new Date(game.when).getTime() + 5 * 60 * 60 * 1000).toISOString()
    : undefined;

  const location = game.location?.name
    ? getLocationByName(game.location.name)
    : undefined;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-gray-600">
          Calendar
        </Link>
        <IoChevronForward className="text-gray-400" size={14} />
        {year && month && (
          <>
            <Link
              to={`/calendar/${year}/${month.toLowerCase()}`}
              className="hover:text-primary text-gray-600"
            >
              {month} {year}
            </Link>
            <IoChevronForward className="text-gray-400" size={14} />
          </>
        )}
        <span className="text-dark font-medium">{title}</span>
      </div>

      <div className="flex flex-col items-start gap-6">
        {/* Header row: sponsor left, time + calendar right */}
        <div className="flex w-full flex-row flex-wrap items-stretch justify-between gap-2 md:gap-4">
          {game.sponsor && (
            <div className="flex-1">
              <SponsorBadge sponsor={game.sponsor} />
            </div>
          )}
          {!game.sponsor && game.when && (
            <div className="flex-1">
              <SponsorThisGame gameId={game.id} when={game.when} />
            </div>
          )}
          {game.when && <When start={game.when} end={finish} />}
        </div>

        {/* Match details */}
        <div className="flex w-full flex-col gap-4">
          <div className="flex w-full items-center justify-between">
            <h4 className="text-lg font-semibold md:text-xl">Match Details</h4>
            {game.when && (
              <AddToCalendarButton
                hideBranding
                name={title}
                options={[
                  "Apple",
                  "Google",
                  "iCal",
                  "Microsoft365",
                  "MicrosoftTeams",
                  "Outlook.com",
                  "Yahoo",
                ]}
                location={game.location?.name}
                startDate={formatInTimeZone(
                  new Date(game.when),
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
                  new Date(game.when),
                  "Europe/London",
                  "HH:mm",
                )}
                endTime={
                  finish
                    ? formatInTimeZone(
                        new Date(finish),
                        "Europe/London",
                        "HH:mm",
                      )
                    : undefined
                }
                timeZone="Europe/London"
                hideRichData
              />
            )}
          </div>
          <ul className="flex flex-col gap-2">
            <li>
              <strong>Team:</strong> {game.team.name}
            </li>
            <li>
              <strong>Opposition:</strong> {game.opposition.club.name}{" "}
              {game.opposition.team.name}
            </li>
            {game.competition.name && (
              <li>
                <strong>Competition:</strong> {game.competition.name}
              </li>
            )}
            {game.home !== undefined && (
              <li>
                <strong>Venue:</strong>{" "}
                <Badge variant={game.home ? "default" : "secondary"}>
                  {game.home ? "Home" : "Away"}
                </Badge>
              </li>
            )}
          </ul>
        </div>

        {/* Team lineup */}
        {game.lineup && game.lineup.players.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <h4 className="text-lg font-semibold">
                {game.lineup.confirmed ? "Team" : "Selected Team"}
              </h4>
              <ol className="list-inside list-decimal space-y-1">
                {game.lineup.players.map((player, i) => (
                  <li key={i} className="text-sm">
                    {player.name}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}

        {/* Result summary — full card if Play Cricket has data, badge-only for manual result */}
        {game.result ? (
          <ResultSummary result={game.result} />
        ) : (
          game.outcome && (
            <Card>
              <CardContent className="flex items-center gap-2 p-4">
                <OutcomeBadge outcome={game.outcome} />
                <span className="text-sm text-gray-600">
                  Full scorecard pending
                </span>
              </CardContent>
            </Card>
          )
        )}

        {/* MDX game report */}
        {report && (
          <div className="w-full">
            <MDXProvider components={mdxComponents}>
              <div className="mdx-content flex flex-col *:mb-4">
                <report.Component />
              </div>
            </MDXProvider>
          </div>
        )}

        {/* Scorecard (fetches from Play Cricket API) */}
        <Scorecard matchId={game.id} when={game.when} />
      </div>

      {/* Map */}
      {location?.lat != null && location?.lon != null && (
        <Map
          center={{ lat: location.lat, lon: location.lon }}
          infoWindow={{ header: location.name }}
        >
          <div className="flex flex-col gap-2 bg-white p-4 text-lg sm:text-sm">
            <h4 className="text-lg font-semibold md:text-xl">
              {location.name}
            </h4>
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

export function Component() {
  const { id } = useParams<{ id: string }>();
  useStripOgParam();

  const { data: game, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}", {
          params: { path: { matchId: id ?? "" } },
        }),
      ),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  useDocumentMeta(
    game ? `${game.team.name} vs ${game.opposition.club.name}` : "Game Details",
  );

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col gap-4">
          <div className="h-6 w-64 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
          <div className="h-32 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold">Game Not Found</h1>
        <p className="mt-2 text-gray-600">This game could not be found.</p>
        <Link
          to="/calendar"
          className="text-primary mt-4 inline-block hover:underline"
        >
          Back to calendar
        </Link>
      </div>
    );
  }

  return <GameDetailContent game={game} />;
}
