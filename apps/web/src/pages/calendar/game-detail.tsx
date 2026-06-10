import { ContentBody } from "@/components/content-body.js";
import { Map } from "@/components/map.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { OutcomeBadge } from "@/components/outcome-badge.js";
import { Scorecard } from "@/components/scorecard.js";
import { Badge } from "@/components/ui/badge.js";
import { Button, buttonVariants } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { WagonWheelModal } from "@/components/wagon-wheel-modal.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { hasWagonWheel, useWagonWheelQuery } from "@/hooks/use-wagon-wheel.js";
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

  const { data: pendingData } = useQuery({
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

  if (!isFuture || pendingData?.hasPending) return null;

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
      <p className="text-sm text-orange-600">No match sponsor… yet</p>
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
  const isPairs = result.gameType === "Pairs";
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {result.outcome && <OutcomeBadge outcome={result.outcome} />}
          {isPairs && (
            <span className="rounded-full bg-stone-700 px-2 py-0.5 text-xs font-semibold text-white">
              Women&apos;s Softball
            </span>
          )}
          {result.toss && (
            <span className="text-sm text-stone-600">{result.toss}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {result.innings.map((inn) => (
            <div
              key={`${inn.teamBattingId}-${inn.runs}-${inn.wickets}-${inn.overs}`}
              className="flex items-baseline justify-between gap-4"
            >
              <span className="text-sm font-medium">{inn.teamName}</span>
              <span className="flex items-baseline gap-2 font-mono text-sm font-semibold tabular-nums">
                <span>{formatInningsScore(inn)}</span>
                {inn.netScore !== null && (
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-bold text-green-800">
                    Net {inn.netScore}
                  </span>
                )}
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
  const hasValidWebsite =
    !!sponsor.website && /^https?:\/\//i.test(sponsor.website);

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
            hasValidWebsite && "underline decoration-dotted underline-offset-2",
          )}
        >
          {sponsor.name}
        </p>
        {sponsor.phone && (
          <a
            href={`tel:${sponsor.phone}`}
            className="mt-1 block text-sm text-orange-700 underline decoration-dotted underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {sponsor.phone}
          </a>
        )}
      </div>
      {sponsor.message && (
        <p className="text-sm text-orange-600">{sponsor.message}</p>
      )}
    </div>
  );

  if (hasValidWebsite) {
    return (
      <a
        href={sponsor.website ?? ""}
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

function BallByBallTrigger({ game }: { game: GameData }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.get("bbb") === "1";
  // Always run the query — needed to decide whether to show the button at
  // all. react-query caches it for the modal so opening is instant.
  const { data, isLoading } = useWagonWheelQuery(game.id);
  const available = hasWagonWheel(data);

  function setOpen(next: boolean) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("bbb", "1");
    else params.delete("bbb");
    setSearchParams(params, { replace: true });
  }

  // Hide button when no data — but if the URL says open, still mount the
  // modal so the fallback shows.
  if (!open && (isLoading || !available)) return null;

  const inningsTeamNames = game.result?.innings.map((inn) => inn.teamName);

  return (
    <>
      {available && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Ball by ball viewer
        </Button>
      )}
      <WagonWheelModal
        matchId={game.id}
        open={open}
        onOpenChange={setOpen}
        inningsTeamNames={inningsTeamNames}
      />
    </>
  );
}

function GameDetailContent({ game }: { game: GameData }) {
  // DB-backed report first (live content editing, #479); the bundled MDX
  // corpus stays as fallback until the migration is verified in prod,
  // then gets deleted in a follow-up.
  const { data: apiReport, isPending: apiReportPending } = useQuery({
    queryKey: ["content", "game-report", game.id],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET(
            "/api/content/game-report/by-play-cricket-id/{playCricketId}",
            {
              params: { path: { playCricketId: game.id } },
            },
          ),
        );
      } catch (err) {
        // No published report for this game - fall back to bundled MDX.
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    // Scheduled publishing boundary: a null result can flip to published
    // the instant its published_at passes, so misses go stale fast while
    // a real report keeps the full 5 minutes.
    staleTime: (query) =>
      query.state.data === null ? 30 * 1000 : 5 * 60 * 1000,
    retry: false,
  });
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

  const isFutureGame = game.when
    ? isAfter(new Date(game.when), new Date())
    : false;
  const hasHeaderRow = !!game.sponsor || isFutureGame;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-stone-600">
          Calendar
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        {year && month && (
          <>
            <Link
              to={`/calendar/${year}/${month.toLowerCase()}`}
              className="hover:text-primary text-stone-600"
            >
              {month} {year}
            </Link>
            <IoChevronForward className="text-stone-400" size={14} />
          </>
        )}
        <span className="text-dark font-medium">{title}</span>
      </div>

      <div className="flex flex-col items-start gap-6">
        {/* Header row: sponsor left, date card right.
            Skipped entirely for past non-sponsored games — the date card then
            sits inline next to Match Details so nothing is pushed down. */}
        {hasHeaderRow && (
          <div className="flex w-full flex-row flex-wrap items-stretch justify-end gap-2 md:gap-4">
            {game.sponsor ? (
              <div className="flex-1">
                <SponsorBadge sponsor={game.sponsor} />
              </div>
            ) : (
              game.when && (
                <div className="flex-1">
                  <SponsorThisGame gameId={game.id} when={game.when} />
                </div>
              )
            )}
            {game.when && <When start={game.when} end={finish} />}
          </div>
        )}

        {/* Match details */}
        <div className="flex w-full flex-col gap-4 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {game.when && isFutureGame && (
              <div className="flex w-full justify-end">
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
              </div>
            )}
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
          {!game.sponsor && game.when && !isFutureGame && (
            <When start={game.when} end={finish} />
          )}
        </div>

        {/* Team lineup — hidden once Play Cricket has a result (scorecard shows actual teams) */}
        {!game.result && game.lineup && game.lineup.players.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <h4 className="text-lg font-semibold">
                {game.lineup.confirmed ? "Team" : "Selected Team"}
              </h4>
              <ol className="list-inside list-decimal space-y-1">
                {game.lineup.players.map((player, pos) => (
                  <li key={`${pos}-${player.name}`} className="text-sm">
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
                <span className="text-sm text-stone-600">
                  Full scorecard pending
                </span>
              </CardContent>
            </Card>
          )
        )}

        {/* Ball-by-ball viewer — button only renders if wagon-wheel data
            exists; modal still mounts when ?bbb=1 is in the URL so direct
            links show a fallback. */}
        <BallByBallTrigger game={game} />

        {/* Game report: API-published content wins. The bundled MDX
            renders only once the query settles (confirmed 404, or an API
            failure - deliberate graceful degradation) so a DB-edited
            report never flashes its stale MDX ancestor first. */}
        {apiReport ? (
          <div className="w-full">
            <ContentBody body={apiReport.body} />
          </div>
        ) : (
          !apiReportPending &&
          report && (
            <div className="w-full">
              <MDXProvider components={mdxComponents}>
                <div className="mdx-content flex flex-col *:mb-4">
                  <report.Component />
                </div>
              </MDXProvider>
            </div>
          )
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
          <div className="h-6 w-64 animate-pulse rounded bg-stone-200" />
          <div className="h-4 w-48 animate-pulse rounded bg-stone-100" />
          <div className="h-32 animate-pulse rounded bg-stone-100" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold">Game Not Found</h1>
        <p className="mt-2 text-stone-600">This game could not be found.</p>
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
