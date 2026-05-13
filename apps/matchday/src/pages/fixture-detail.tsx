import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router";

interface GameDetail {
  id: string;
  date: string;
  startTime?: string | null;
  teamName?: string | null;
  opposition?: string | null;
  competition?: string | null;
  ground?: string | null;
  away: boolean;
  played: boolean;
  result?: string | null;
  scoreSummary?: string | null;
  playCricketUrl?: string | null;
  matchdayId?: string | null;
}

export default function FixtureDetail() {
  const { matchId } = useParams();
  const { data, isLoading, isError } = useQuery({
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
  if (isError) return <ErrState />;
  const game = data as unknown as GameDetail | undefined;
  if (!game) return <ErrState />;
  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      <header className="bg-navy px-5 py-6 text-white">
        <Link
          to="/fixtures"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/70"
        >
          <ArrowLeftIcon className="size-3.5" /> Fixtures
        </Link>
        <p className="text-[11px] uppercase tracking-[0.06em] text-white/70">
          {fmtDate(game.date, "EEEE · d MMMM")} ·{" "}
          {game.startTime ??
            new Date(game.date).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em] leading-tight">
          {game.teamName ?? "Percy Main"} vs {game.opposition ?? "TBC"}
        </h1>
        <p className="mt-1 text-sm text-white/75">
          {[game.away ? "Away" : "Home", game.ground, game.competition]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {game.played && game.scoreSummary && (
          <div className="mt-4 inline-block rounded-md bg-white/10 px-3 py-2 text-base font-semibold">
            {game.scoreSummary}
          </div>
        )}
      </header>

      <div className="p-4 space-y-3">
        {game.matchdayId && (
          <Button asChild tone="primary" className="w-full">
            <Link to={`/matchday/${game.matchdayId}`}>View team sheet</Link>
          </Button>
        )}
        {game.playCricketUrl && (
          <Button asChild tone="outline" className="w-full">
            <a href={game.playCricketUrl} target="_blank" rel="noopener">
              View on Play-Cricket ↗
            </a>
          </Button>
        )}
        {game.ground && (
          <Button asChild tone="outline" className="w-full">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                game.ground,
              )}`}
              target="_blank"
              rel="noopener"
            >
              Get directions ↗
            </a>
          </Button>
        )}

        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            Status
          </p>
          {game.played ? (
            <StatusPill tone={resultTone(game.result)} dot>
              {game.result ?? "Finished"}
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

function resultTone(r?: string | null) {
  const v = r?.toUpperCase();
  if (v === "W") return "success" as const;
  if (v === "L") return "danger" as const;
  if (v === "D" || v === "T") return "warning" as const;
  return "neutral" as const;
}

function Skel() {
  return (
    <div className="p-4">
      <div className="h-24 rounded-xl bg-border" />
      <div className="mt-3 h-11 rounded-md bg-border" />
    </div>
  );
}

function ErrState() {
  return (
    <div className="p-6 text-center text-sm text-text-secondary">
      Couldn't load the fixture.{" "}
      <Link to="/fixtures" className="text-navy-500 underline">
        Back to fixtures
      </Link>
    </div>
  );
}
