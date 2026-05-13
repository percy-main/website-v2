import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

interface MatchdayPlayer {
  id: string;
  member_id: string | null;
  player_name: string;
  status: string;
  is_captain: boolean;
  is_wicketkeeper: boolean;
}
interface MatchdayDetail {
  matchday: {
    id: string;
    match_date: string;
    opposition: string;
    competition_type: string | null;
    status: string;
  };
  team: { id: string; name: string | null } | null;
  players: MatchdayPlayer[];
}
/**
 * Phase 3 matchday edit / squad picker.
 *
 * Search a member, tap to add. Selected players list shows add/remove.
 * Adding a guest by name posts without a memberId (server-side accepts
 * the playerName-only form).
 */
export default function MatchdayEdit() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { matchdayId } = useParams();
  const [search, setSearch] = useState("");
  const [guestName, setGuestName] = useState("");

  const { data: detail, isLoading } = useQuery({
    queryKey: ["matchday", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    enabled: !!matchdayId,
  });

  const searchResults = useQuery({
    queryKey: ["matchday", "members", "search", search],
    enabled: search.length >= 2,
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/members/search", {
          params: { query: { query: search } },
        }),
      ),
  });

  const addPlayer = useMutation({
    mutationFn: (vars: { memberId?: string; playerName: string }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/players", {
          params: { path: { matchId: matchdayId ?? "" } },
          body: vars,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
      setSearch("");
      setGuestName("");
    },
  });

  const removePlayer = useMutation({
    mutationFn: (playerId: string) =>
      callApi(
        api.DELETE("/api/matchday/{matchId}/players/{playerId}", {
          params: {
            path: { matchId: matchdayId ?? "", playerId },
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    },
  });

  if (isLoading)
    return (
      <div className="space-y-2 p-4">
        <div className="h-10 rounded-md bg-border" />
        <div className="h-32 rounded-2xl bg-border" />
      </div>
    );
  if (!detail) return <p className="p-6 text-sm text-text-secondary">Not found.</p>;
  const md = detail as unknown as MatchdayDetail;
  const players = md.players ?? [];
  const playerMemberIds = new Set(
    players.map((p) => p.member_id).filter(Boolean) as string[],
  );

  const candidates =
    (searchResults.data) ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl pb-32">
      <header className="flex items-center gap-3 border-b border-border p-3">
        <Link
          to="/squad"
          aria-label="Back"
          className="grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-raised"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div>
          <strong className="block text-sm">
            {md.team?.name ?? "Team"} vs {md.matchday.opposition}
          </strong>
          <span className="text-[11px] text-text-secondary">
            {fmtDate(md.matchday.match_date, "EEE d MMM")} · pick squad
          </span>
        </div>
      </header>

      <section className="border-b border-border bg-surface p-3">
        <div className="flex items-center gap-2 rounded-xl bg-surface-raised px-3 py-2">
          <SearchIcon className="size-4 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search members…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
          />
        </div>
        {search.length >= 2 && candidates.length > 0 && (
          <ul className="mt-2 space-y-1">
            {candidates
              .filter((c) => !playerMemberIds.has(c.id))
              .slice(0, 6)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() =>
                      addPlayer.mutate({
                        memberId: c.id,
                        playerName: c.name ?? "Unknown",
                      })
                    }
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-surface-raised"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-text-secondary">
                        {c.member_category}
                      </p>
                    </div>
                    <span className="text-xs text-navy">Add →</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 px-4 py-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            Selected · {players.length}
          </p>
          <span className="text-xs text-text-secondary">target 11</span>
        </div>
        {players.length === 0 && (
          <p className="rounded-xl bg-surface-raised px-3 py-3 text-sm text-text-secondary">
            No players yet. Search above or add a guest.
          </p>
        )}
        {players.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.player_name}
                {!p.member_id && (
                  <span className="ml-2 text-[11px] italic text-text-secondary">
                    guest
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              aria-label="Remove"
              onClick={() => removePlayer.mutate(p.id)}
              className="grid size-9 place-items-center rounded-md text-danger hover:bg-danger-bg"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ))}
      </section>

      <section className="border-t border-border bg-surface-raised p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Add a guest
        </p>
        <p className="text-xs text-text-secondary">
          Guests don't receive donation emails.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.currentTarget.value)}
            placeholder="Guest name"
            className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
          />
          <Button
            tone="outline"
            disabled={!guestName.trim() || addPlayer.isPending}
            onClick={() =>
              addPlayer.mutate({ playerName: guestName.trim() })
            }
          >
            <UserPlusIcon className="size-4" /> Add
          </Button>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:static">
        <div className="mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 md:pb-3">
          <Button asChild tone="outline">
            <Link to="/squad">Save & close</Link>
          </Button>
          <Button
            tone="primary"
            disabled={players.length === 0}
            onClick={() => {
              void navigate(`/matchday/${matchdayId ?? ""}/confirm`);
            }}
          >
            Continue → Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
