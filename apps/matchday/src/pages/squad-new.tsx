import { StatusPill } from "@/components/primitives/status-pill.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface UpcomingMatch {
  matchId: string;
  matchDate: string;
  matchTime: string | null;
  opposition: string;
  isHome: boolean;
  competitionName: string | null;
  competitionType: string | null;
  matchdayId: string | null;
  matchdayStatus: string | null;
}

/**
 * Phase 3 matchday create.
 *
 * Pick team (pre-selected via ?teamId=), then a fixture from Play-Cricket
 * upcomings (filtered to date >= today, with "already created" markers).
 * Tapping a fixture creates the matchday record via POST /api/matchday
 * and routes to the squad-picker edit page.
 */
export default function SquadNew() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const initialTeam = params.get("teamId") ?? "";
  const [teamId, setTeamId] = useState(initialTeam);

  const teams = useQuery({
    queryKey: ["matchday", "teams"],
    queryFn: () => callApi(api.GET("/api/matchday/teams")),
  });
  const teamList = (teams.data ?? []).filter((t) => !t.is_junior);

  const upcoming = useQuery({
    queryKey: ["matchday", "teams", teamId, "upcoming"],
    enabled: !!teamId,
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/teams/{teamId}/upcoming", {
          params: { path: { teamId } },
        }),
      ),
  });
  const matches = upcoming.data ?? [];

  const create = useMutation({
    mutationFn: (m: UpcomingMatch) =>
      callApi(
        api.POST("/api/matchday", {
          body: {
            teamId,
            matchDate: m.matchDate,
            opposition: m.opposition,
            ...(m.competitionType && { competitionType: m.competitionType }),
            ...(m.matchId && { playCricketMatchId: m.matchId }),
          },
        }),
      ),
    onSuccess: (data) => {
      const id = data.id;
      void qc.invalidateQueries({ queryKey: ["matchday"] });
      void navigate(`/matchday/${id}/edit`);
    },
  });

  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to="/squad"
          aria-label="Back"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <strong className="text-sm">New matchday</strong>
      </header>

      <section className="px-4 py-4">
        <label className="block">
          <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Team
          </span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.currentTarget.value)}
            className="border-border bg-surface mt-1 h-11 w-full rounded-lg border px-3 text-sm"
          >
            <option value="">Select a team</option>
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {teamId && (
        <section className="px-4">
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Upcoming fixtures
          </p>
          {upcoming.isPending && (
            <div className="bg-border mt-3 h-16 rounded-2xl" />
          )}
          {!upcoming.isPending && matches.length === 0 && (
            <p className="bg-surface-raised text-text-secondary mt-3 rounded-2xl p-4 text-sm">
              No upcoming fixtures for this team in Play-Cricket.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {matches.map((m) => {
              const alreadyCreated = !!m.matchdayId;
              return (
                <button
                  type="button"
                  key={m.matchId}
                  disabled={alreadyCreated || create.isPending}
                  onClick={() => {
                    if (alreadyCreated) {
                      void navigate(`/matchday/${m.matchdayId ?? ""}/edit`);
                    } else {
                      create.mutate(m);
                    }
                  }}
                  className="border-border bg-surface flex w-full items-center justify-between rounded-2xl border p-3 text-left disabled:opacity-60"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {fmtDate(m.matchDate, "EEE d MMM")} · vs {m.opposition}
                    </p>
                    <p className="text-text-secondary mt-0.5 text-xs">
                      {[
                        m.isHome ? "Home" : "Away",
                        m.competitionName,
                        m.matchTime,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {alreadyCreated ? (
                    <StatusPill tone="navy">
                      {m.matchdayStatus ?? "Created"} →
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Create →</StatusPill>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {create.isError && (
        <p className="text-danger px-4 py-2 text-sm">
          Couldn't create the matchday, try again.
        </p>
      )}
    </div>
  );
}
