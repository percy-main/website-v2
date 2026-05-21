import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate, toIsoDate } from "@/features/format.js";
import { oppositionName, played, type GameDetail } from "@/features/games.js";
import { api, callApi } from "@/lib/api-client.js";
import { useSession, type SessionUser } from "@/lib/auth-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

function isOfficial(role: string | null | undefined): boolean {
  return role === "official" || role === "admin";
}

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;
  const showOfficialActions = isOfficial(user?.role ?? null);
  const create = useMutation({
    mutationFn: (vars: {
      teamId: string;
      matchDate: string;
      opposition: string;
      playCricketMatchId: string;
      competitionType?: string | null;
    }) =>
      callApi(
        api.POST("/api/matchday", {
          body: {
            teamId: vars.teamId,
            matchDate: vars.matchDate,
            opposition: vars.opposition,
            playCricketMatchId: vars.playCricketMatchId,
            ...(vars.competitionType
              ? { competitionType: vars.competitionType }
              : {}),
          },
        }),
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["games"] });
      void navigate(`/matchday/${data.id}/edit`);
    },
  });
  if (isLoading) return <Skel />;
  if (isError || !game) return <ErrState />;
  const directionsQuery = directionsTarget(game);
  const matchdayId = game.lineup?.matchdayId ?? null;
  const handlePickTeam = () => {
    const iso = toIsoDate(game.matchDate);
    if (!iso) return;
    create.mutate({
      teamId: game.team.id,
      matchDate: iso,
      opposition: oppositionName(game),
      playCricketMatchId: game.id,
      competitionType: game.competition.type ?? null,
    });
  };
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

        {showOfficialActions && (
          <section className="border-border bg-surface space-y-2 rounded-2xl border p-3">
            <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
              Manage this match
            </p>
            {matchdayId ? (
              <>
                <Button asChild tone="outline" className="w-full">
                  <Link to={`/matchday/${matchdayId}/edit`}>
                    Manage squad →
                  </Link>
                </Button>
                {/* Same screen pre- and post-match: pre-match it's the
                    captain's live view (squad statuses, expenses), post-
                    match it's the wrap-up (result picker, mark-paid).
                    No gate on match date - captains wrap up the same
                    evening, before the date-based isPast check flips. */}
                <Button asChild tone="primary" className="w-full">
                  <Link to={`/matchday/${matchdayId}/wrap`}>Manage game →</Link>
                </Button>
              </>
            ) : (
              <Button
                tone="primary"
                className="w-full"
                disabled={create.isPending}
                onClick={handlePickTeam}
              >
                {create.isPending ? "Creating…" : "Pick team →"}
              </Button>
            )}
            {create.isError && (
              <p className="text-danger text-xs">
                Couldn't create the matchday. Try again.
              </p>
            )}
          </section>
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

        {game.lineup && game.lineup.players.length > 0 && (
          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
                {game.lineup.confirmed ? "Team" : "Probable team"}
              </p>
              <StatusPill
                tone={game.lineup.confirmed ? "success" : "warning"}
                dot
              >
                {game.lineup.confirmed ? "Confirmed" : "Provisional"}
              </StatusPill>
            </div>
            <ol className="border-border-light bg-surface divide-border-light divide-y rounded-lg border">
              {game.lineup.players.map((p, i) => (
                <li
                  key={`${i}-${p.name}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="text-text-secondary w-5 text-right text-[11px] tabular-nums">
                    {i + 1}
                  </span>
                  <span>{p.name}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
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
