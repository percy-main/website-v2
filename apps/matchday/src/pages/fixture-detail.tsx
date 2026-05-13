import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { oppositionName, played, type GameDetail } from "@/features/games.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router";

export default function FixtureDetail() {
  const { matchId } = useParams();
  const {
    data: game,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["games", matchId],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}", {
          params: { path: { matchId: matchId ?? "" } },
        }),
      ),
    enabled: !!matchId,
  });
  if (isLoading) return <Skel />;
  if (isError || !game) return <ErrState />;
  const directionsQuery = directionsTarget(game);
  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      <header className="bg-navy px-5 py-6 text-white">
        <Link
          to="/fixtures"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/70"
        >
          <ArrowLeftIcon className="size-3.5" /> Fixtures
        </Link>
        <p className="text-[11px] tracking-[0.06em] text-white/70 uppercase">
          {fmtDate(game.matchDate, "EEEE · d MMMM")}
          {game.matchTime ? ` · ${game.matchTime}` : ""}
        </p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-[-0.015em]">
          {game.team.name} vs {oppositionName(game)}
        </h1>
        <p className="mt-1 text-sm text-white/75">
          {[game.home ? "Home" : "Away", game.groundName, game.competition.name]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {played(game) && game.scoreDescription && (
          <div className="mt-4 inline-block rounded-md bg-white/10 px-3 py-2 text-base font-semibold">
            {game.scoreDescription}
          </div>
        )}
      </header>

      <div className="space-y-3 p-4">
        {directionsQuery && (
          <Button asChild tone="outline" className="w-full">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noopener"
            >
              Get directions ↗
            </a>
          </Button>
        )}

        <div className="mt-4">
          <p className="text-text-secondary mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
            Status
          </p>
          {played(game) ? (
            <StatusPill tone={resultTone(game.outcome)} dot>
              {game.outcome ?? "Finished"}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" dot>
              Upcoming
            </StatusPill>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Only offer directions for AWAY games — players don't need directions
 * to their own ground. Prefer the structured location object when we
 * have it (geocodes much better than a plain ground name), fall back
 * to the bare groundName otherwise.
 */
function directionsTarget(g: GameDetail): string | null {
  if (g.home) return null;
  if (g.location) {
    return [
      g.location.name,
      g.location.street,
      g.location.city,
      g.location.postcode,
    ]
      .filter(Boolean)
      .join(", ");
  }
  return g.groundName;
}

function resultTone(o: GameDetail["outcome"]) {
  if (o === "W") return "success" as const;
  if (o === "L") return "danger" as const;
  if (o === "D" || o === "T") return "warning" as const;
  return "neutral" as const;
}

function Skel() {
  return (
    <div className="p-4">
      <div className="bg-border h-24 rounded-xl" />
      <div className="bg-border mt-3 h-11 rounded-md" />
    </div>
  );
}

function ErrState() {
  return (
    <div className="text-text-secondary p-6 text-center text-sm">
      Couldn't load the fixture.{" "}
      <Link to="/fixtures" className="text-navy-500 underline">
        Back to fixtures
      </Link>
    </div>
  );
}
