import { Button } from "@/components/ui/button.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

type MatchdayDetail = ApiResponse<"/api/matchday/{matchId}">;
type MatchdayPlayer = MatchdayDetail["players"][number];

type PlayerStatus = "playing" | "dropped_out" | "no_show";
type Step = 1 | 2 | 3;

/**
 * Phase 3 confirm stepper.
 *
 * 1. Statuses — playing / dropped out / no-show
 * 2. Roles — captain + keeper (one of each, client-validated)
 * 3. Review — submit (POST /confirm, PUT /roles)
 */
export default function MatchdayConfirm() {
  const { matchdayId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [statuses, setStatuses] = useState<Record<string, PlayerStatus>>({});
  const [captain, setCaptain] = useState<string | null>(null);
  const [keeper, setKeeper] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["matchday", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    enabled: !!matchdayId,
  });

  const md: MatchdayDetail | undefined = data;
  const players = useMemo(() => md?.players ?? [], [md?.players]);

  // Seed defaults from the players list — derive each render rather than
  // setState-in-effect (which would loop until the dep equality settled).
  const effectiveStatuses = useMemo<Record<string, PlayerStatus>>(() => {
    const merged: Record<string, PlayerStatus> = {};
    for (const p of players) merged[p.id] = statuses[p.id] ?? "playing";
    return merged;
  }, [players, statuses]);

  const confirmTeam = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday/{matchId}/confirm", {
          params: { path: { matchId: matchdayId ?? "" } },
          body: {
            playerStatuses: Object.entries(effectiveStatuses).map(
              ([matchdayPlayerId, status]) => ({ matchdayPlayerId, status }),
            ),
          },
        }),
      ),
  });
  const setRoles = useMutation({
    mutationFn: () =>
      callApi(
        api.PUT("/api/matchday/{matchId}/roles", {
          params: { path: { matchId: matchdayId ?? "" } },
          body: {
            captainPlayerId: captain,
            wicketkeeperPlayerId: keeper,
          },
        }),
      ),
  });

  async function submit() {
    await confirmTeam.mutateAsync();
    await setRoles.mutateAsync();
    void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    void navigate(`/matchday/${matchdayId ?? ""}/live`);
  }

  if (!md) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-10 rounded-md bg-border" />
        <div className="h-32 rounded-2xl bg-border" />
      </div>
    );
  }

  const playing = players.filter((p) => effectiveStatuses[p.id] === "playing");
  const dropped = players.filter((p) => effectiveStatuses[p.id] === "dropped_out");
  const noShow = players.filter((p) => effectiveStatuses[p.id] === "no_show");
  const canContinue =
    step === 2
      ? captain !== null && keeper !== null
      : true;

  return (
    <div className="mx-auto w-full max-w-2xl pb-32">
      <header className="flex items-center gap-3 border-b border-border p-3">
        <Link
          to={`/matchday/${matchdayId ?? ""}/edit`}
          aria-label="Back"
          className="grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-raised"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="flex-1">
          <strong className="text-sm">Confirm team</strong>
          <p className="text-[11px] text-text-secondary">
            {md.team?.name ?? "Team"} vs {md.matchday.opposition} ·{" "}
            {fmtDate(md.matchday.match_date, "EEE d MMM")}
          </p>
        </div>
        <span className="text-xs text-text-secondary">{step} / 3</span>
      </header>

      <div className="flex gap-1.5 px-4 py-3">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full",
              n < step ? "bg-success" : n === step ? "bg-navy" : "bg-border",
            )}
          />
        ))}
      </div>

      {step === 1 && (
        <Step1
          players={players}
          statuses={effectiveStatuses}
          setStatus={(id, s) => setStatuses((prev) => ({ ...prev, [id]: s }))}
        />
      )}
      {step === 2 && (
        <Step2
          players={playing}
          captain={captain}
          keeper={keeper}
          setCaptain={setCaptain}
          setKeeper={setKeeper}
        />
      )}
      {step === 3 && (
        <Step3
          playing={playing}
          dropped={dropped}
          noShow={noShow}
          captainName={
            playing.find((p) => p.id === captain)?.player_name ?? null
          }
          keeperName={
            playing.find((p) => p.id === keeper)?.player_name ?? null
          }
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:static">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 md:pb-3">
          {step > 1 && (
            <Button
              tone="outline"
              size="sm"
              onClick={() => setStep((step - 1) as Step)}
            >
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              tone="primary"
              className="flex-1"
              disabled={!canContinue}
              onClick={() => setStep((step + 1) as Step)}
            >
              {step === 1 ? "Next · roles" : "Next · review"}
            </Button>
          )}
          {step === 3 && (
            <Button
              tone="primary"
              size="lg"
              className="flex-1"
              disabled={confirmTeam.isPending || setRoles.isPending}
              onClick={() => {
                void submit();
              }}
            >
              {confirmTeam.isPending || setRoles.isPending
                ? "Confirming…"
                : "Confirm team"}
            </Button>
          )}
        </div>
      </div>

      {(confirmTeam.isError || setRoles.isError) && (
        <p className="px-4 py-2 text-sm text-danger">
          Couldn't confirm, try again.
        </p>
      )}
    </div>
  );
}

function Step1({
  players,
  statuses,
  setStatus,
}: {
  players: MatchdayPlayer[];
  statuses: Record<string, PlayerStatus>;
  setStatus: (id: string, s: PlayerStatus) => void;
}) {
  return (
    <div className="space-y-1">
      <header className="px-4 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Step 1 · statuses
        </p>
        <h2 className="text-lg font-semibold">Anyone dropping out?</h2>
        <p className="text-sm text-text-secondary">
          Everyone is "Playing" by default.
        </p>
      </header>
      <ul className="divide-y divide-border-light">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 bg-surface px-4 py-2.5"
          >
            <p className="flex-1 text-sm font-medium">{p.player_name}</p>
            <div className="flex gap-1">
              {(["playing", "dropped_out", "no_show"] as PlayerStatus[]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(p.id, s)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px] font-semibold",
                      statuses[p.id] === s
                        ? statusClasses(s)
                        : "bg-border text-text-secondary",
                    )}
                  >
                    {statusLabel(s)}
                  </button>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step2({
  players,
  captain,
  keeper,
  setCaptain,
  setKeeper,
}: {
  players: MatchdayPlayer[];
  captain: string | null;
  keeper: string | null;
  setCaptain: (id: string | null) => void;
  setKeeper: (id: string | null) => void;
}) {
  return (
    <div>
      <header className="px-4 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Step 2 · roles
        </p>
        <h2 className="text-lg font-semibold">Captain & wicketkeeper</h2>
        <p className="text-sm text-text-secondary">One of each.</p>
      </header>
      <ul className="divide-y divide-border-light">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 bg-surface px-4 py-2.5"
          >
            <div className="flex-1">
              <p className="text-sm font-medium">{p.player_name}</p>
            </div>
            <button
              type="button"
              onClick={() => setCaptain(captain === p.id ? null : p.id)}
              aria-pressed={captain === p.id}
              className={cn(
                "grid size-9 place-items-center rounded-md",
                captain === p.id
                  ? "bg-warning-bg text-warning"
                  : "text-text-secondary hover:bg-surface-raised",
              )}
              title="Captain"
            >
              <CrownIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setKeeper(keeper === p.id ? null : p.id)}
              aria-pressed={keeper === p.id}
              className={cn(
                "grid size-9 place-items-center rounded-md",
                keeper === p.id
                  ? "bg-info-bg text-navy dark:text-white"
                  : "text-text-secondary hover:bg-surface-raised",
              )}
              title="Wicketkeeper"
            >
              <GloveIcon className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step3({
  playing,
  dropped,
  noShow,
  captainName,
  keeperName,
}: {
  playing: MatchdayPlayer[];
  dropped: MatchdayPlayer[];
  noShow: MatchdayPlayer[];
  captainName: string | null;
  keeperName: string | null;
}) {
  return (
    <div className="space-y-3 px-4 pt-2">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Step 3 · review
        </p>
        <h2 className="text-lg font-semibold">Ready to confirm?</h2>
      </header>
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
        <p className="font-semibold">
          {playing.length} playing · {dropped.length} dropped · {noShow.length}{" "}
          no-show
        </p>
        <p className="mt-2 text-text-secondary">
          Captain: <strong>{captainName ?? "—"}</strong>
        </p>
        <p className="text-text-secondary">
          Keeper: <strong>{keeperName ?? "—"}</strong>
        </p>
      </div>
      <p className="rounded-2xl bg-warning-bg p-3 text-xs text-warning">
        Confirming creates donations using the current rates from the admin
        schedule. Donations are charged via the main site (Stripe).
      </p>
    </div>
  );
}

function statusLabel(s: PlayerStatus): string {
  return s === "playing" ? "Playing" : s === "dropped_out" ? "Dropped" : "No-show";
}
function statusClasses(s: PlayerStatus): string {
  if (s === "playing") return "bg-success text-white";
  if (s === "dropped_out") return "bg-danger text-white";
  return "bg-warning text-white";
}
