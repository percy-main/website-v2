import { ContentBody } from "@/components/content-body.js";
import { Map } from "@/components/map.js";
import { OutcomeBadge } from "@/components/outcome-badge.js";
import { Scorecard } from "@/components/scorecard.js";
import { StampButton, StampLink } from "@/components/theme/bits.js";
import { WagonWheelModal } from "@/components/wagon-wheel-modal.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { hasBallByBall, useWagonWheelQuery } from "@/hooks/use-wagon-wheel.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import {
  gameQueryOptions,
  gameReportQueryOptions,
} from "@/lib/games-queries.js";
import { cn } from "@/lib/utils.js";
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
    <div className="border-cta bg-surface text-primary flex w-full flex-col items-center gap-2 border-2 px-4 py-3">
      <p className="text-cta text-sm">No match sponsor… yet</p>
      <StampLink to={`/calendar/game/${gameId}/sponsor`}>
        Sponsor This Game →
      </StampLink>
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
    <div className="border-cta bg-surface text-primary flex w-full flex-row items-center justify-between gap-4 border-2 p-4 md:w-auto">
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
    <div className="border-primary bg-surface flex flex-col gap-3 border-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {result.outcome && <OutcomeBadge outcome={result.outcome} />}
        {isPairs && (
          <span className="bg-primary text-paper rounded-full px-2 py-0.5 text-xs font-semibold">
            Women&apos;s Softball
          </span>
        )}
        {result.toss && (
          <span className="text-muted text-sm">{result.toss}</span>
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
                <span className="border-border bg-surface text-primary rounded border px-1.5 py-0.5 text-xs font-bold">
                  Net {inn.netScore}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <div className="border-cta bg-surface flex w-full flex-col items-center gap-2 border-2 px-4 py-3">
      {sponsor.logoUrl && (
        <img
          src={sponsor.logoUrl}
          alt={sponsor.name}
          className="h-12 max-w-[120px] rounded object-contain"
        />
      )}
      <div className="text-center">
        <p className="text-cta text-xs">Match sponsored by</p>
        <p
          className={cn(
            "text-cta text-lg font-semibold",
            hasValidWebsite && "underline decoration-dotted underline-offset-2",
          )}
        >
          {sponsor.name}
        </p>
        {sponsor.phone && (
          <a
            href={`tel:${sponsor.phone}`}
            className="text-cta mt-1 block text-sm underline decoration-dotted underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {sponsor.phone}
          </a>
        )}
      </div>
      {sponsor.message && <p className="text-cta text-sm">{sponsor.message}</p>}
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
  const available = hasBallByBall(data);

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
        <StampButton variant="navy" size="sm" onClick={() => setOpen(true)}>
          Ball by ball viewer →
        </StampButton>
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
  // DB-backed report (live content editing, #479). Shared options so the
  // prerenderer seeds the exact key this reads.
  const { data: apiReport } = useQuery(gameReportQueryOptions(game.id));

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

  const location = game.location;

  const isFutureGame = game.when
    ? isAfter(new Date(game.when), new Date())
    : false;
  const hasHeaderRow = !!game.sponsor || isFutureGame;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/calendar" className="hover:text-primary text-muted">
          Calendar
        </Link>
        <IoChevronForward className="text-muted" size={14} />
        {year && month && (
          <>
            <Link
              to={`/calendar/${year}/${month.toLowerCase()}`}
              className="hover:text-primary text-muted"
            >
              {month} {year}
            </Link>
            <IoChevronForward className="text-muted" size={14} />
          </>
        )}
        <span className="fc-two-tone font-medium">{title}</span>
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
                  <span
                    className={cn(
                      "inline-flex items-center border-2 px-2 py-0.5 text-xs font-bold tracking-wider uppercase",
                      game.home
                        ? "border-primary text-primary"
                        : "border-cta text-cta",
                    )}
                  >
                    {game.home ? "Home" : "Away"}
                  </span>
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
          <div className="border-primary bg-surface flex flex-col gap-3 border-2 p-4">
            <h4 className="fc-two-tone text-lg font-semibold">
              {game.lineup.confirmed ? "Team" : "Selected Team"}
            </h4>
            <ol className="list-inside list-decimal space-y-1">
              {game.lineup.players.map((player, pos) => (
                <li key={`${pos}-${player.name}`} className="text-sm">
                  {player.name}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Result summary — full card if Play Cricket has data, badge-only for manual result */}
        {game.result ? (
          <ResultSummary result={game.result} />
        ) : (
          game.outcome && (
            <div className="border-primary bg-surface flex items-center gap-2 border-2 p-4">
              <OutcomeBadge outcome={game.outcome} />
              <span className="text-muted text-sm">Full scorecard pending</span>
            </div>
          )
        )}

        {/* Ball-by-ball viewer — button only renders if ball-by-ball data
            exists; modal still mounts when ?bbb=1 is in the URL so direct
            links show a fallback. */}
        <BallByBallTrigger game={game} />

        {/* Game report (API-published content) */}
        {apiReport && (
          <div className="w-full">
            <ContentBody body={apiReport.body} />
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
          <div className="border-primary bg-surface text-primary flex flex-col gap-2 border-2 p-4 text-lg sm:text-sm">
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
    ...gameQueryOptions(id ?? ""),
    enabled: !!id,
  });

  useDocumentMeta(
    game ? `${game.team.name} vs ${game.opposition.club.name}` : "Game Details",
  );

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col gap-4">
          <div className="bg-primary/10 h-6 w-64 animate-pulse rounded" />
          <div className="bg-primary/10 h-4 w-48 animate-pulse rounded" />
          <div className="bg-primary/10 h-32 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="fc-two-tone text-2xl font-semibold">Game Not Found</h1>
        <p className="text-muted mt-2">This game could not be found.</p>
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
