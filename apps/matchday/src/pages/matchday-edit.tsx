import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { shareOrDownloadTeamNewsImage } from "@/features/team-news-image.js";
import { useDebouncedValue } from "@/hooks/use-debounced-value.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ImageIcon,
  SearchIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

type MatchdayDetail = ApiResponse<"/api/matchday/{matchId}">;
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
  const debouncedSearch = useDebouncedValue(search, 250);
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

  // Home/away + start time live on the public projection (sourced from
  // play-cricket), not the official detail endpoint. Fetch it alongside
  // so the team-news-image download has accurate query params.
  const publicDetail = useQuery({
    queryKey: ["matchday", matchdayId, "public"],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}/public", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    enabled: !!matchdayId,
  });

  const downloadImage = useMutation({
    mutationFn: () => {
      if (!matchdayId) throw new Error("Match id missing");
      return shareOrDownloadTeamNewsImage({
        matchId: matchdayId,
        isHome: publicDetail.data?.away === false,
        matchTime: publicDetail.data?.startTime ?? null,
      });
    },
  });

  const searchResults = useQuery({
    queryKey: ["matchday", "members", "search", debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/members/search", {
          params: { query: { query: debouncedSearch } },
        }),
      ),
  });

  const addPlayer = useMutation({
    mutationFn: (vars: {
      memberId?: string;
      dependentId?: string;
      playerName: string;
    }) =>
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

  const setRoles = useMutation({
    mutationFn: (vars: {
      captainPlayerId: string | null;
      wicketkeeperPlayerId: string | null;
    }) =>
      callApi(
        api.PUT("/api/matchday/{matchId}/roles", {
          params: { path: { matchId: matchdayId ?? "" } },
          body: vars,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    },
  });

  if (isLoading)
    return (
      <div className="space-y-2 p-4">
        <div className="bg-border h-10 rounded-md" />
        <div className="bg-border h-32 rounded-2xl" />
      </div>
    );
  if (!detail)
    return <p className="text-text-secondary p-6 text-sm">Not found.</p>;
  const md: MatchdayDetail = detail;
  const players = md.players;
  const playerMemberIds = new Set(
    players.flatMap((p) => (p.member_id ? [p.member_id] : [])),
  );
  const playerDependentIds = new Set(
    players.flatMap((p) => (p.dependent_id ? [p.dependent_id] : [])),
  );

  const candidates = searchResults.data ?? [];

  // Where "Back" / "Done" / "Save & close" send the user. Prefer the
  // fixture detail screen if we have a Play Cricket match id (the
  // matchday-edit page is always opened from there); otherwise fall
  // back to the fixtures list.
  const exitTo = md.matchday.play_cricket_match_id
    ? `/fixture/${md.matchday.play_cricket_match_id}`
    : "/fixtures";

  return (
    <div className="mx-auto w-full max-w-2xl pb-32">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to={exitTo}
          aria-label="Back"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">
            {md.team?.name ?? "Team"} vs {md.matchday.opposition}
          </strong>
          <span className="text-text-secondary text-[11px]">
            {fmtDate(md.matchday.match_date, "EEE d MMM")} · pick squad
          </span>
        </div>
        <button
          type="button"
          onClick={() => downloadImage.mutate()}
          disabled={
            downloadImage.isPending ||
            players.length === 0 ||
            publicDetail.isLoading
          }
          className="text-text-secondary hover:bg-surface-raised inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
          aria-label="Download team news image"
        >
          <ImageIcon className="size-4" />
          {downloadImage.isPending ? "Preparing…" : "Team image"}
        </button>
      </header>
      {downloadImage.isError && (
        <p className="text-danger px-4 pt-2 text-xs">
          Couldn't generate team image. Try again.
        </p>
      )}

      <section className="border-border bg-surface border-b p-3">
        <div className="bg-surface-raised flex items-center gap-2 rounded-xl px-3 py-2">
          <SearchIcon className="text-text-secondary size-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search members…"
            className="placeholder:text-text-muted w-full bg-transparent text-sm outline-none"
          />
        </div>
        {debouncedSearch.length >= 2 && candidates.length > 0 && (
          <ul className="mt-2 space-y-1">
            {candidates
              .filter((c) =>
                c.type === "member"
                  ? !playerMemberIds.has(c.id)
                  : !playerDependentIds.has(c.id),
              )
              .slice(0, 6)
              .map((c) => (
                <li key={`${c.type}-${c.id}`}>
                  <button
                    type="button"
                    onClick={() =>
                      addPlayer.mutate(
                        c.type === "member"
                          ? {
                              memberId: c.id,
                              playerName: c.name ?? "Unknown",
                            }
                          : {
                              dependentId: c.id,
                              playerName: c.name,
                            },
                      )
                    }
                    className="hover:bg-surface-raised flex w-full items-center justify-between rounded-md px-2 py-2 text-left"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-text-secondary text-xs">
                        {c.type === "member"
                          ? c.member_category
                          : c.parent_name
                            ? `junior · ${c.parent_name}`
                            : "junior"}
                      </p>
                    </div>
                    <span className="text-navy text-xs">Add →</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 px-4 py-4">
        <div className="flex items-baseline justify-between">
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Selected · {players.length}
          </p>
          <span className="text-text-secondary text-xs">target 11</span>
        </div>
        {players.length === 0 && (
          <p className="bg-surface-raised text-text-secondary rounded-xl px-3 py-3 text-sm">
            No players yet. Search above or add a guest.
          </p>
        )}
        {players.map((p) => {
          const captainId = players.find((x) => x.is_captain)?.id ?? null;
          const keeperId = players.find((x) => x.is_wicketkeeper)?.id ?? null;
          return (
            <div
              key={p.id}
              className="border-border bg-surface flex items-center gap-2 rounded-xl border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {p.player_name}
                  {p.dependent_id ? (
                    <span className="text-text-secondary ml-2 text-[11px] italic">
                      junior
                    </span>
                  ) : !p.member_id ? (
                    <span className="text-text-secondary ml-2 text-[11px] italic">
                      guest
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                aria-label={p.is_captain ? "Unset captain" : "Set as captain"}
                aria-pressed={p.is_captain}
                disabled={setRoles.isPending}
                onClick={() =>
                  setRoles.mutate({
                    captainPlayerId: p.is_captain ? null : p.id,
                    wicketkeeperPlayerId: keeperId,
                  })
                }
                className={cn(
                  "grid size-9 place-items-center rounded-md border",
                  p.is_captain
                    ? "border-warning bg-warning-bg text-warning"
                    : "border-border text-text-secondary",
                )}
              >
                <CrownIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label={
                  p.is_wicketkeeper ? "Unset keeper" : "Set as keeper"
                }
                aria-pressed={p.is_wicketkeeper}
                disabled={setRoles.isPending}
                onClick={() =>
                  setRoles.mutate({
                    captainPlayerId: captainId,
                    wicketkeeperPlayerId: p.is_wicketkeeper ? null : p.id,
                  })
                }
                className={cn(
                  "grid size-9 place-items-center rounded-md border",
                  p.is_wicketkeeper
                    ? "border-info bg-info-bg text-info"
                    : "border-border text-text-secondary",
                )}
              >
                <GloveIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => removePlayer.mutate(p.id)}
                className="text-danger hover:bg-danger-bg grid size-9 place-items-center rounded-md"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          );
        })}
      </section>

      <section className="border-border bg-surface-raised border-t p-4">
        <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Add a guest
        </p>
        <p className="text-text-secondary text-xs">
          Guests don't receive donation emails.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.currentTarget.value)}
            placeholder="Guest name"
            className="border-border bg-surface h-11 flex-1 rounded-lg border px-3 text-sm"
          />
          <Button
            tone="outline"
            disabled={!guestName.trim() || addPlayer.isPending}
            onClick={() => addPlayer.mutate({ playerName: guestName.trim() })}
          >
            <UserPlusIcon className="size-4" /> Add
          </Button>
        </div>
      </section>

      <div className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:static">
        <div className="mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] md:pb-3">
          <Button asChild tone="outline">
            <Link to={exitTo}>Save & close</Link>
          </Button>
          <Button
            tone="primary"
            disabled={players.length === 0}
            onClick={() => {
              void navigate(exitTo);
            }}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
