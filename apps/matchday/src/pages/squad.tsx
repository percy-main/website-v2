import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Link } from "react-router";

interface Team {
  id: string;
  name: string | null;
  is_junior: boolean;
}

/**
 * Phase 3 squad teams dashboard.
 *
 * Lists the teams the user is an official of (admin/club-wide users see
 * all), with upcoming matches and any past-unfinished matchdays that
 * need finalising. The "Create matchday" entry point lives on each
 * team card.
 */
export default function Squad() {
  const { data: teams, isLoading } = useQuery({
    queryKey: ["matchday", "teams"],
    queryFn: () => callApi(api.GET("/api/matchday/teams")),
  });
  const list = (teams ?? []).filter((t) => !t.is_junior);
  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pt-6 pb-2">
        <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Squad
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">
          Your teams
        </h1>
      </header>
      {isLoading && (
        <div className="space-y-2 px-4 py-4">
          {["a", "b"].map((s) => (
            <div key={s} className="bg-border h-32 rounded-2xl" />
          ))}
        </div>
      )}
      {!isLoading && list.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold">No teams</p>
          <p className="text-text-secondary mt-1 text-sm">
            You're not yet assigned as an official to any team. An admin can add
            you on the main site.
          </p>
        </div>
      )}
      <div className="space-y-3 px-4 py-3">
        {list.map((t) => (
          <TeamCard key={t.id} team={t} />
        ))}
      </div>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const upcoming = useQuery({
    queryKey: ["matchday", "teams", team.id, "upcoming"],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/teams/{teamId}/upcoming", {
          params: { path: { teamId: team.id } },
        }),
      ),
  });
  const past = useQuery({
    queryKey: ["matchday", "teams", team.id, "past-unfinished"],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/teams/{teamId}/past-unfinished", {
          params: { path: { teamId: team.id } },
        }),
      ),
  });
  const upcomingMatches = upcoming.data ?? [];
  const pendingPick = upcomingMatches.filter((m) => !m.matchdayId);
  const confirmed = upcomingMatches.filter(
    (m) => m.matchdayStatus === "confirmed",
  );
  const pastUnfinished = past.data ?? [];

  return (
    <div className="border-border bg-surface rounded-2xl border p-4">
      <div className="flex items-baseline justify-between">
        <strong className="text-base font-semibold">
          {team.name ?? "Team"}
        </strong>
        <span className="text-text-secondary text-xs">
          {upcomingMatches.length} upcoming
        </span>
      </div>

      {pastUnfinished.length > 0 && (
        <div className="border-warning-bg bg-warning-bg/40 mt-3 rounded-xl border p-3">
          <p className="text-warning text-[11px] font-semibold tracking-[0.06em] uppercase">
            Needs attention
          </p>
          <p className="mt-1 text-sm">
            {pastUnfinished.length} past match
            {pastUnfinished.length === 1 ? "" : "es"} not yet finalised
          </p>
          <Link
            to={`/matchday/${pastUnfinished[0].id}/live`}
            className="text-warning mt-2 inline-block text-xs font-semibold underline"
          >
            Finalise the oldest →
          </Link>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {confirmed.slice(0, 1).map((m) => (
          <Link
            key={m.matchId}
            to={`/matchday/${m.matchdayId ?? ""}/live`}
            className="bg-navy block rounded-xl p-3 text-white"
          >
            <p className="text-[11px] font-semibold tracking-[0.06em] uppercase opacity-70">
              Today / next match
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              vs {m.opposition} · {fmtDate(m.matchDate, "EEE d MMM")}
            </p>
            <p className="mt-0.5 text-[11px] opacity-80">Open captain view →</p>
          </Link>
        ))}
        {pendingPick.length > 0 && (
          <Link
            to={`/squad/new?teamId=${team.id}`}
            className="border-border bg-surface-raised flex items-center justify-between rounded-xl border px-3 py-3"
          >
            <span className="text-sm font-medium">Pick the team</span>
            <StatusPill tone="warning">
              {pendingPick.length} fixture
              {pendingPick.length === 1 ? "" : "s"} pending
            </StatusPill>
          </Link>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button asChild tone="outline" size="sm" className="flex-1">
          <Link to={`/squad/new?teamId=${team.id}`}>
            <PlusIcon className="size-4" />
            New matchday
          </Link>
        </Button>
      </div>
    </div>
  );
}
