import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { fmtDate, toIsoDate } from "@/features/format.js";
import { oppositionName, played, type GameDetail } from "@/features/games.js";
import { api, callApi } from "@/lib/api-client.js";
import {
  canManageMatchday,
  useSession,
  type SessionUser,
} from "@/lib/auth-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, BanIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

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
  // Every affordance in the "Manage this match" section mutates the
  // matchday (Pick team / Manage squad / Manage game / Cancel), so gate
  // on `matchday:manage` — the same permission the API's `adminRole`
  // preHandler enforces — not the broader `matchday:view`.
  const showOfficialActions = canManageMatchday(user);
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

  // A matchday only exists once selection has started (see Pick team /
  // Go to selection below). Fetch its detail so the official actions can
  // offer "Cancel match" and reflect an already-cancelled match - the
  // game payload itself carries no matchday status. `matchdayId` stays
  // set after cancellation (the games query has no status filter), so a
  // cancelled match keeps showing here rather than reverting to Pick team.
  const matchdayId = game?.lineup?.matchdayId ?? null;
  const { data: matchdayDetail } = useQuery({
    queryKey: ["matchday", matchdayId],
    enabled: !!matchdayId && showOfficialActions,
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const cancelMatch = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday/{matchId}/cancel", {
          params: { path: { matchId: matchdayId ?? "" } },
          body: cancelReason.trim() ? { reason: cancelReason.trim() } : {},
        }),
      ),
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason("");
      void qc.invalidateQueries({ queryKey: ["games"] });
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    },
  });

  if (isLoading) return <Skel />;
  if (isError || !game) return <ErrState />;
  const directionsQuery = directionsTarget(game);
  const matchdayStatus = matchdayDetail?.matchday.status ?? null;
  const matchdayCancelled = matchdayStatus === "cancelled";
  // Cancel is a close-off-without-charging action: the API only allows it
  // on a live (pending/confirmed) matchday, not a finished one.
  const canCancelMatchday =
    matchdayStatus === "pending" || matchdayStatus === "confirmed";
  // Surfacing only the open case: once this fixture's team is confirmed
  // (on the selection screen, or when the request closes) a matchday
  // exists and matchdayId is set above, so the squad-management buttons
  // take over and this never renders.
  const openAvailabilityRequest =
    game.availabilityRequest?.status === "open"
      ? game.availabilityRequest
      : null;
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
              matchdayCancelled ? (
                <div className="border-border bg-danger-bg rounded-xl border p-3">
                  <p className="text-danger text-sm font-medium">
                    Match cancelled
                  </p>
                  {matchdayDetail?.matchday.cancelled_reason && (
                    <p className="text-text-secondary mt-1 text-xs">
                      {matchdayDetail.matchday.cancelled_reason}
                    </p>
                  )}
                  {matchdayDetail?.matchday.cancelled_at && (
                    <p className="text-text-secondary mt-1 text-[11px]">
                      Cancelled{" "}
                      {fmtDate(
                        matchdayDetail.matchday.cancelled_at,
                        "EEE d MMM",
                      )}
                    </p>
                  )}
                </div>
              ) : (
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
                    <Link to={`/matchday/${matchdayId}/wrap`}>
                      Manage game →
                    </Link>
                  </Button>
                  {canCancelMatchday && (
                    <button
                      type="button"
                      onClick={() => setCancelOpen(true)}
                      className="text-danger hover:bg-danger-bg flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium"
                    >
                      <BanIcon className="size-4" /> Cancel match
                    </button>
                  )}
                </>
              )
            ) : openAvailabilityRequest ? (
              <>
                <p className="text-text-secondary text-xs leading-snug">
                  Team selection is underway. Confirm this team on the selection
                  screen to create the matchday - the rest of the availability
                  request stays open.
                </p>
                <Button asChild tone="primary" className="w-full">
                  <Link
                    to={`/official/availability/${openAvailabilityRequest.id}/date/${openAvailabilityRequest.date}`}
                  >
                    Go to selection →
                  </Link>
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

      {showOfficialActions && (
        <Dialog
          open={cancelOpen}
          onOpenChange={(open) => {
            if (!cancelMatch.isPending) setCancelOpen(open);
          }}
        >
          <DialogContent className="w-[calc(100%-1.5rem)] max-w-md sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancel this match?</DialogTitle>
              <DialogDescription>
                Marks {game.team.name} vs {oppositionName(game)} as cancelled.
                Players won&apos;t be charged a match donation. This can&apos;t
                be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <label
                htmlFor="cancel-reason"
                className="text-text-secondary text-xs font-medium"
              >
                Reason (optional)
              </label>
              <textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.currentTarget.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. Rained off, opposition withdrew"
                className="border-border bg-surface mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            {cancelMatch.isError && (
              <p className="text-danger mt-2 text-xs">
                {cancelMatch.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                tone="outline"
                onClick={() => setCancelOpen(false)}
                disabled={cancelMatch.isPending}
              >
                Keep match
              </Button>
              <Button
                tone="destructive"
                onClick={() => cancelMatch.mutate()}
                disabled={cancelMatch.isPending}
              >
                {cancelMatch.isPending ? "Cancelling…" : "Cancel match"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
