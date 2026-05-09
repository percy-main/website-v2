import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { API_BASE, api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen.js";
import { useSession } from "@/lib/auth-client";
import { compressImage } from "@/lib/image-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { useReducer, useRef, useState } from "react";
import { Link } from "react-router";
import {
  buildAddExpensePayload,
  buildConfirmPayload,
  confirmationFormReducer,
  expenseFormReducer,
  initialConfirmationFormState,
  initialExpenseFormState,
  type ExpenseType as ReducerExpenseType,
} from "./official.reducer";

// ── Constants ──

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  card: "Card",
};

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  umpire_fee: "Umpire Fee",
  scorer_fee: "Scorer Fee",
  match_ball: "Match Ball",
  teas: "Teas",
  miscellaneous: "Miscellaneous",
};

const RESULT_TYPE_LABELS: Record<string, string> = {
  W: "Won",
  L: "Lost",
  D: "Draw",
  T: "Tied",
  A: "Abandoned",
  C: "Cancelled",
  N: "No Result",
};

const RESULT_TYPE_OPTIONS = ["W", "L", "D", "T", "A", "C", "N"] as const;

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

// ── Derived API types ──

type MatchdayData =
  paths["/api/matchday/{matchId}"]["get"]["responses"][200]["content"]["application/json"];
type MatchdayExpense = MatchdayData["expenses"][number];

// ── Team news image download ──

function DownloadTeamNewsButton({
  matchdayId,
  isHome,
  matchTime,
  size = "sm",
}: {
  matchdayId: string;
  isHome: boolean;
  matchTime?: string | null;
  size?: "sm" | "default";
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = () => {
    setDownloading(true);
    // Raw fetch: endpoint returns a PNG blob, not JSON — openapi-fetch can't handle binary downloads
    void fetch(
      `${API_BASE}/matchday/${encodeURIComponent(matchdayId)}/team-news-image?isHome=${isHome}${matchTime ? `&matchTime=${encodeURIComponent(matchTime)}` : ""}`,
      { credentials: "include" },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to generate image");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `team-news-${matchdayId}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .finally(() => {
        setDownloading(false);
      });
  };

  return (
    <Button
      size={size}
      variant="outline"
      disabled={downloading}
      onClick={handleDownload}
    >
      {downloading ? "Generating…" : "Download Image"}
    </Button>
  );
}

// ── Role selectors (captain / wicketkeeper) ──

function RoleSelectors({
  players,
  disabled,
  onChange,
}: {
  players: Array<{
    id: string;
    player_name: string;
    is_captain: boolean;
    is_wicketkeeper: boolean;
  }>;
  disabled: boolean;
  onChange: (roles: {
    captainPlayerId: string | null;
    wicketkeeperPlayerId: string | null;
  }) => void;
}) {
  const CLEAR = "__none__";
  const captain = players.find((p) => p.is_captain)?.id ?? CLEAR;
  const wicketkeeper = players.find((p) => p.is_wicketkeeper)?.id ?? CLEAR;

  const update = (next: {
    captainPlayerId: string | null;
    wicketkeeperPlayerId: string | null;
  }) => {
    onChange(next);
  };

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-stone-700">Captain (*)</span>
        <Select
          value={captain}
          disabled={disabled}
          onValueChange={(value) =>
            update({
              captainPlayerId: value === CLEAR ? null : value,
              wicketkeeperPlayerId:
                wicketkeeper === CLEAR ? null : wicketkeeper,
            })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select captain" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLEAR}>None</SelectItem>
            {players.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.player_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-stone-700">Wicketkeeper (†)</span>
        <Select
          value={wicketkeeper}
          disabled={disabled}
          onValueChange={(value) =>
            update({
              captainPlayerId: captain === CLEAR ? null : captain,
              wicketkeeperPlayerId: value === CLEAR ? null : value,
            })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select wicketkeeper" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLEAR}>None</SelectItem>
            {players.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.player_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

// ── Component ──

export function Component() {
  useDocumentMeta("Match Official");
  const { data: session } = useSession();

  if (!session) return null;

  const { user } = session;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1>Team Management</h1>
          <div className="flex gap-2">
            {user.role === "admin" && (
              <Link
                className="rounded border border-stone-800 px-4 py-2 text-sm text-stone-900 hover:bg-stone-200"
                to="/admin"
              >
                Admin Panel
              </Link>
            )}
            <Link
              className="rounded border border-stone-800 px-4 py-2 text-sm text-stone-900 hover:bg-stone-200"
              to="/matchday"
            >
              Matchday
            </Link>
          </div>
        </div>
        <TeamsDashboard />
      </div>
    </div>
  );
}

function TeamsDashboard() {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedMatchday, setSelectedMatchday] = useState<{
    id: string;
    isHome: boolean;
    matchTime: string | null;
  } | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["official", "myTeams"],
    queryFn: () => callApi(api.GET("/api/matchday/teams")),
  });

  if (teamsQuery.isPending) {
    return <p className="text-stone-500">Loading teams…</p>;
  }

  if (teamsQuery.isError) {
    return <p className="text-red-600">Failed to load teams.</p>;
  }

  const teams = (teamsQuery.data ?? []).filter((t) => !t.is_junior);

  if (teams.length === 0) {
    return (
      <p className="text-stone-500">
        No teams assigned. Contact an admin to be assigned as an official.
      </p>
    );
  }

  if (selectedMatchday) {
    return (
      <MatchdayView
        matchdayId={selectedMatchday.id}
        isHome={selectedMatchday.isHome}
        matchTime={selectedMatchday.matchTime}
        onBack={() => setSelectedMatchday(null)}
      />
    );
  }

  if (selectedTeamId) {
    return (
      <TeamMatchesView
        teamId={selectedTeamId}
        teamName={teams.find((t) => t.id === selectedTeamId)?.name ?? ""}
        onBack={() => setSelectedTeamId(null)}
        onSelectMatchday={(id, isHome, matchTime) =>
          setSelectedMatchday({ id, isHome, matchTime })
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <Card
          key={team.id}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => setSelectedTeamId(team.id)}
        >
          <CardHeader>
            <CardTitle className="text-lg">{team.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-stone-500">
              Click to view upcoming matches
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TeamMatchesView({
  teamId,
  teamName,
  onBack,
  onSelectMatchday,
}: {
  teamId: string;
  teamName: string;
  onBack: () => void;
  onSelectMatchday: (
    id: string,
    isHome: boolean,
    matchTime: string | null,
  ) => void;
}) {
  const queryClient = useQueryClient();

  const matchesQuery = useQuery({
    queryKey: ["official", "upcomingMatches", teamId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/teams/{teamId}/upcoming", {
          params: { path: { teamId } },
        }),
      ),
  });

  const createMatchdayMutation = useMutation({
    mutationFn: (input: {
      teamId: string;
      matchDate: string;
      opposition: string;
      competitionType?: string;
      playCricketMatchId?: string;
      isHome: boolean;
    }) =>
      callApi(
        api.POST("/api/matchday", {
          body: {
            teamId: input.teamId,
            matchDate: input.matchDate,
            opposition: input.opposition,
            competitionType: input.competitionType,
            playCricketMatchId: input.playCricketMatchId,
          },
        }),
      ),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "upcomingMatches", teamId],
      });
      if (data?.id) {
        onSelectMatchday(data.id, variables.isHome, null);
      }
    },
  });

  const matches = matchesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <h2 className="text-xl font-semibold">{teamName}</h2>
      </div>

      {matchesQuery.isPending && (
        <p className="text-stone-500">Loading matches…</p>
      )}
      {matchesQuery.isError && (
        <p className="text-red-600">Failed to load matches.</p>
      )}

      {matches.length === 0 && !matchesQuery.isPending && (
        <p className="text-stone-500">No upcoming matches found.</p>
      )}

      <div className="grid gap-3">
        {matches.map((match) => {
          const matchDate = parse(match.matchDate, "dd/MM/yyyy", new Date());
          const isoDate = format(matchDate, "yyyy-MM-dd");

          return (
            <Card key={match.matchId}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">
                    {match.isHome ? "vs" : "@"} {match.opposition}
                  </p>
                  <p className="text-sm text-stone-500">
                    {format(matchDate, "EEEE d MMMM yyyy")}
                    {match.matchTime ? ` at ${match.matchTime}` : ""}
                  </p>
                  {(match.competitionName ?? match.competitionType) && (
                    <p className="text-xs text-stone-400">
                      {match.competitionType && (
                        <span className="mr-1 rounded bg-stone-100 px-1 py-0.5 font-medium text-stone-600">
                          {match.competitionType}
                        </span>
                      )}
                      {match.competitionName}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {match.matchdayId ? (
                    <>
                      <DownloadTeamNewsButton
                        matchdayId={match.matchdayId}
                        isHome={match.isHome}
                        matchTime={match.matchTime}
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          onSelectMatchday(
                            match.matchdayId ?? "",
                            match.isHome,
                            match.matchTime ?? null,
                          )
                        }
                      >
                        {match.matchdayStatus === "confirmed"
                          ? "View Confirmed"
                          : match.matchdayStatus === "finished"
                            ? "View Finished"
                            : "Edit Squad"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createMatchdayMutation.isPending}
                      onClick={() =>
                        createMatchdayMutation.mutate({
                          teamId,
                          matchDate: isoDate,
                          opposition: match.opposition,
                          competitionType: match.competitionType ?? undefined,
                          playCricketMatchId: match.matchId,
                          isHome: match.isHome,
                        })
                      }
                    >
                      {createMatchdayMutation.isPending
                        ? "Creating…"
                        : "Start Matchday"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {createMatchdayMutation.isError && (
        <p className="text-sm text-red-600">Failed to create matchday.</p>
      )}
    </div>
  );
}

// eslint-disable-next-line react-doctor/no-giant-component -- captain/official matchday view: player roster + add/remove + payment confirmation + result selector + expense management + team-news image; all sections share the matchday query and 6+ mutations. Sub-sections (RoleSelectors, DownloadTeamNewsButton, ExpensesSection) are already siblings. TODO: extract the result-entry bar once additional result-types are added.
function MatchdayView({
  matchdayId,
  isHome,
  matchTime,
  onBack,
}: {
  matchdayId: string;
  isHome: boolean;
  matchTime: string | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  type ResultType = "W" | "L" | "D" | "T" | "A" | "C" | "N";
  interface MatchdayLocalState {
    searchQuery: string;
    showAddForm: boolean;
    adHocName: string;
    payingPlayerId: string | null;
    selectedResultType: ResultType | "";
  }
  const [local, updateLocal] = useReducer(
    (s: MatchdayLocalState, p: Partial<MatchdayLocalState>) => ({ ...s, ...p }),
    {
      searchQuery: "",
      showAddForm: false,
      adHocName: "",
      payingPlayerId: null,
      selectedResultType: "",
    },
  );
  const {
    searchQuery,
    showAddForm,
    adHocName,
    payingPlayerId,
    selectedResultType,
  } = local;
  const [confirmation, dispatchConfirmation] = useReducer(
    confirmationFormReducer,
    initialConfirmationFormState,
  );
  const confirmingTeam = confirmation.confirming;
  const playerStatuses = confirmation.playerStatuses;

  const matchdayQuery = useQuery({
    queryKey: ["official", "matchday", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}", {
          params: { path: { matchId: matchdayId } },
        }),
      ),
  });

  const searchMembersQuery = useQuery({
    queryKey: ["official", "searchMembers", searchQuery],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/members/search", {
          params: { query: { query: searchQuery } },
        }),
      ),
    enabled: searchQuery.length >= 2,
  });

  const addPlayerMutation = useMutation({
    mutationFn: (input: { memberId?: string; playerName: string }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/players", {
          params: { path: { matchId: matchdayId } },
          body: input,
        }),
      ),
    onSuccess: () => {
      updateLocal({ searchQuery: "" });
      updateLocal({ adHocName: "" });
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const removePlayerMutation = useMutation({
    mutationFn: (playerId: string) =>
      callApi(
        api.DELETE("/api/matchday/{matchId}/players/{playerId}", {
          params: { path: { matchId: matchdayId, playerId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const confirmTeamMutation = useMutation({
    mutationFn: (input: {
      playerStatuses: Array<{
        matchdayPlayerId: string;
        status: "playing" | "dropped_out" | "no_show";
      }>;
    }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/confirm", {
          params: { path: { matchId: matchdayId } },
          body: input,
        }),
      ),
    onSuccess: () => {
      dispatchConfirmation({ type: "reset" });
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (input: {
      playerId: string;
      paymentMethod: "cash" | "bank_transfer" | "card";
    }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/players/{playerId}/mark-paid", {
          params: {
            path: { matchId: matchdayId, playerId: input.playerId },
          },
          body: { paymentMethod: input.paymentMethod },
        }),
      ),
    onSuccess: () => {
      updateLocal({ payingPlayerId: null });
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const finishMatchMutation = useMutation({
    mutationFn: (resultType: "W" | "L" | "D" | "T" | "A" | "C" | "N") =>
      callApi(
        api.POST("/api/matchday/{matchId}/finish", {
          params: { path: { matchId: matchdayId } },
          body: { resultType },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const setRolesMutation = useMutation({
    mutationFn: (input: {
      captainPlayerId: string | null;
      wicketkeeperPlayerId: string | null;
    }) =>
      callApi(
        api.PUT("/api/matchday/{matchId}/roles", {
          params: { path: { matchId: matchdayId } },
          body: input,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const addExpenseMutation = useMutation({
    mutationFn: (input: {
      type:
        | "umpire_fee"
        | "scorer_fee"
        | "match_ball"
        | "teas"
        | "miscellaneous";
      description?: string;
      amountPence: number;
      receiptImage?: string;
    }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/expenses", {
          params: { path: { matchId: matchdayId } },
          body: input,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (expenseId: string) =>
      callApi(
        api.DELETE("/api/matchday/expenses/{expenseId}", {
          params: { path: { expenseId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["official", "matchday", matchdayId],
      });
    },
  });

  const data = matchdayQuery.data;
  const players = (data?.players ?? []).filter(
    (p): p is typeof p & { id: string } => p.id !== null,
  );
  const searchResults = searchMembersQuery.data ?? [];
  const existingMemberIds = new Set(
    players.flatMap((p) => (p.member_id ? [p.member_id] : [])),
  );

  const handleStartConfirm = () => {
    dispatchConfirmation({
      type: "start",
      playerIds: players.flatMap((p) => (p.id ? [p.id] : [])),
    });
  };

  const handleConfirm = () => {
    confirmTeamMutation.mutate(buildConfirmPayload(confirmation));
  };

  const statusColors: Record<string, string> = {
    selected: "bg-stone-100 text-stone-700",
    playing: "bg-green-100 text-green-800",
    dropped_out: "bg-yellow-100 text-yellow-800",
    no_show: "bg-red-100 text-red-800",
    replaced: "bg-orange-100 text-orange-800",
  };

  const statusLabels: Record<string, string> = {
    selected: "Selected",
    playing: "Playing",
    dropped_out: "Dropped Out",
    no_show: "No Show",
    replaced: "Replaced",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        {matchdayQuery.isPending ? (
          <p className="text-stone-500">Loading…</p>
        ) : data ? (
          <div>
            <h2 className="text-xl font-semibold">
              {data.team?.name} vs {data.matchday.opposition}
            </h2>
            <p className="text-sm text-stone-500">
              {format(new Date(data.matchday.match_date), "EEEE d MMMM yyyy")}
              <span
                className={`ml-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${
                  data.matchday.status === "pending"
                    ? "bg-yellow-100 text-yellow-800"
                    : data.matchday.status === "confirmed"
                      ? "bg-green-100 text-green-800"
                      : "bg-stone-100 text-stone-800"
                }`}
              >
                {data.matchday.status}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {matchdayQuery.isError && (
        <p className="text-red-600">Failed to load matchday.</p>
      )}

      {data && (
        <>
          {/* Current squad */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Squad ({players.length})</span>
                <div className="flex gap-2">
                  {players.length > 0 && (
                    <DownloadTeamNewsButton
                      matchdayId={matchdayId}
                      isHome={isHome}
                      matchTime={matchTime}
                    />
                  )}
                  {data.matchday.status === "pending" && !confirmingTeam && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateLocal({ showAddForm: !showAddForm })
                        }
                      >
                        {showAddForm ? "Cancel" : "Add Player"}
                      </Button>
                      {players.length > 0 && (
                        <Button size="sm" onClick={handleStartConfirm}>
                          Confirm Team
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {players.length > 0 &&
                data.matchday.status !== "finished" &&
                !confirmingTeam && (
                  <RoleSelectors
                    players={players}
                    disabled={setRolesMutation.isPending}
                    onChange={(roles) => setRolesMutation.mutate(roles)}
                  />
                )}
              {players.length === 0 ? (
                <p className="text-sm text-stone-500">
                  No players selected yet.
                </p>
              ) : confirmingTeam ? (
                /* Confirmation mode */
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-stone-600">
                    Set each player&apos;s status and confirm the team.
                  </p>
                  {players.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded border border-stone-200 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">{player.player_name}</p>
                        {player.member_category && (
                          <p className="text-xs text-stone-400 capitalize">
                            {player.member_category}
                          </p>
                        )}
                      </div>
                      <Select
                        value={playerStatuses[player.id] ?? "playing"}
                        onValueChange={(
                          value: "playing" | "dropped_out" | "no_show",
                        ) =>
                          dispatchConfirmation({
                            type: "setStatus",
                            playerId: player.id,
                            status: value,
                          })
                        }
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="playing">Playing</SelectItem>
                          <SelectItem value="dropped_out">
                            Dropped Out
                          </SelectItem>
                          <SelectItem value="no_show">No Show</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleConfirm}
                      disabled={confirmTeamMutation.isPending}
                    >
                      {confirmTeamMutation.isPending
                        ? "Confirming…"
                        : "Confirm Team"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => dispatchConfirmation({ type: "cancel" })}
                    >
                      Cancel
                    </Button>
                  </div>
                  {confirmTeamMutation.isError && (
                    <p className="text-sm text-red-600">
                      Failed to confirm team.
                    </p>
                  )}
                </div>
              ) : (
                /* Normal view - shows player list with statuses */
                <div className="flex flex-col gap-2">
                  {players.map((player, idx) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded border border-stone-200 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-center text-sm font-medium text-stone-400">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-medium">
                            {player.player_name}
                            {player.is_captain && (
                              <span
                                className="ml-1 text-stone-500"
                                title="Captain"
                              >
                                *
                              </span>
                            )}
                            {player.is_wicketkeeper && (
                              <span
                                className="ml-0.5 text-stone-500"
                                title="Wicketkeeper"
                              >
                                †
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            {player.member_category && (
                              <span className="text-xs text-stone-400 capitalize">
                                {player.member_category}
                              </span>
                            )}
                            {data.matchday.status !== "pending" && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusColors[player.status] ?? ""}`}
                              >
                                {statusLabels[player.status] ?? player.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Match fee payment controls for confirmed matchdays */}
                        {data.matchday.status === "confirmed" &&
                          player.status === "playing" &&
                          player.charge_id &&
                          !player.chargePaidAt && (
                            <>
                              {payingPlayerId === player.id ? (
                                <div className="flex items-center gap-1">
                                  {(
                                    ["cash", "bank_transfer", "card"] as const
                                  ).map((method) => (
                                    <Button
                                      key={method}
                                      size="sm"
                                      variant="outline"
                                      disabled={markPaidMutation.isPending}
                                      onClick={() =>
                                        markPaidMutation.mutate({
                                          playerId: player.id,
                                          paymentMethod: method,
                                        })
                                      }
                                    >
                                      {PAYMENT_METHOD_LABELS[method]}
                                    </Button>
                                  ))}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      updateLocal({ payingPlayerId: null })
                                    }
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateLocal({ payingPlayerId: player.id })
                                  }
                                >
                                  Mark Paid
                                </Button>
                              )}
                            </>
                          )}
                        {/* Show fee status */}
                        {data.matchday.status !== "pending" &&
                          player.status === "playing" &&
                          payingPlayerId !== player.id &&
                          (player.chargePaidAt ? (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
                              Fee paid
                            </span>
                          ) : player.charge_id ? (
                            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800">
                              Fee pending
                            </span>
                          ) : (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">
                              No fee set
                            </span>
                          ))}
                        {/* Remove button for pending matchdays */}
                        {data.matchday.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-800"
                            disabled={removePlayerMutation.isPending}
                            onClick={() =>
                              removePlayerMutation.mutate(player.id)
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add player form */}
          {showAddForm && data.matchday.status === "pending" && (
            <Card>
              <CardHeader>
                <CardTitle>Add Player</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <Input
                    placeholder="Search members by name…"
                    value={searchQuery}
                    onChange={(e) =>
                      updateLocal({ searchQuery: e.target.value })
                    }
                  />
                  {searchMembersQuery.isPending && searchQuery.length >= 2 && (
                    <p className="mt-2 text-sm text-stone-500">Searching…</p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded border border-stone-200">
                      {searchResults.flatMap((member) =>
                        existingMemberIds.has(member.id)
                          ? []
                          : [
                              <button
                                key={member.id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50"
                                disabled={addPlayerMutation.isPending}
                                onClick={() =>
                                  addPlayerMutation.mutate({
                                    memberId: member.id,
                                    playerName: member.name ?? "Unknown",
                                  })
                                }
                              >
                                <div>
                                  <span className="font-medium">
                                    {member.name}
                                  </span>
                                  {member.member_category && (
                                    <span className="ml-2 text-xs text-stone-400 capitalize">
                                      {member.member_category}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-stone-400">
                                  {member.email}
                                </span>
                              </button>,
                            ],
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-stone-200 pt-4">
                  <p className="mb-2 text-sm text-stone-600">
                    Or add a player not in the system:
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Player name"
                      value={adHocName}
                      onChange={(e) =>
                        updateLocal({ adHocName: e.target.value })
                      }
                    />
                    <Button
                      size="sm"
                      disabled={
                        !adHocName.trim() || addPlayerMutation.isPending
                      }
                      onClick={() =>
                        addPlayerMutation.mutate({
                          playerName: adHocName.trim(),
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {addPlayerMutation.isError && (
                  <p className="text-sm text-red-600">Failed to add player.</p>
                )}
              </CardContent>
            </Card>
          )}

          {markPaidMutation.isError && (
            <p className="text-sm text-red-600">Failed to mark payment.</p>
          )}

          {/* Expenses section - visible for confirmed and finished matchdays */}
          {data.matchday.status !== "pending" && (
            <ExpensesSection
              matchdayId={matchdayId}
              expenses={data.expenses ?? []}
              isFinished={data.matchday.status === "finished"}
              addExpenseMutation={addExpenseMutation}
              deleteExpenseMutation={deleteExpenseMutation}
            />
          )}

          {/* Finish Match with result confirmation */}
          {data.matchday.status === "confirmed" && (
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">Finish Match</p>
                <p className="mb-3 text-sm text-stone-500">
                  Select the match result and finish. Unpaid match fees will
                  remain as charges and notification emails will be sent.
                </p>
                <div className="flex items-center gap-3">
                  <Select
                    value={selectedResultType}
                    onValueChange={(v) =>
                      updateLocal({ selectedResultType: v as ResultType })
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select result" />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULT_TYPE_OPTIONS.map((code) => (
                        <SelectItem key={code} value={code}>
                          {RESULT_TYPE_LABELS[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="destructive"
                    disabled={
                      !selectedResultType || finishMatchMutation.isPending
                    }
                    onClick={() =>
                      selectedResultType &&
                      finishMatchMutation.mutate(selectedResultType)
                    }
                  >
                    {finishMatchMutation.isPending
                      ? "Finishing…"
                      : "Finish Match"}
                  </Button>
                </div>
                {finishMatchMutation.isError && (
                  <p className="mt-2 text-sm text-red-600">
                    Failed to finish match.
                  </p>
                )}
                {finishMatchMutation.isSuccess && (
                  <p className="mt-2 text-sm text-green-600">
                    Match finished. Notification emails sent for unpaid fees.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Finished status message with result */}
          {data.matchday.status === "finished" && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stone-500">
                      This match has been finished.
                      {data.matchday.result_type &&
                        ` Result: ${RESULT_TYPE_LABELS[data.matchday.result_type] ?? data.matchday.result_type}.`}
                      {data.matchday.finished_at &&
                        ` Completed on ${format(new Date(data.matchday.finished_at), "dd/MM/yyyy HH:mm")}.`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

type ExpenseType = ReducerExpenseType;

// eslint-disable-next-line react-doctor/no-giant-component -- per-matchday expenses panel: expense list + add form (driven by expenseFormReducer) + receipt upload + delete. The reducer + form share validation and mutation lifecycle.
function ExpensesSection({
  expenses,
  isFinished,
  addExpenseMutation,
  deleteExpenseMutation,
}: {
  matchdayId: string;
  expenses: MatchdayExpense[];
  isFinished: boolean;
  addExpenseMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      {
        type: ExpenseType;
        description?: string;
        amountPence: number;
        receiptImage?: string;
      }
    >
  >;
  deleteExpenseMutation: ReturnType<typeof useMutation<unknown, Error, string>>;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [expenseForm, dispatchExpense] = useReducer(
    expenseFormReducer,
    initialExpenseFormState,
  );
  const {
    expenseType,
    description,
    amount,
    matchBallUsed,
    matchBallCost,
    receiptPreview,
    compressing,
  } = expenseForm;
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount_pence, 0);

  const resetForm = () => {
    dispatchExpense({ type: "resetFields" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReceiptCapture = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    dispatchExpense({ type: "setCompressing", value: true });
    try {
      const dataUrl = await compressImage(file, {
        maxDimension: 1200,
        maxBytes: 400_000,
      });
      dispatchExpense({ type: "setReceipt", preview: dataUrl, dataUrl });
    } catch {
      // Image processing failed
      dispatchExpense({ type: "setReceipt", preview: null, dataUrl: null });
    } finally {
      dispatchExpense({ type: "setCompressing", value: false });
    }
  };

  const handleExpenseTypeChange = (newType: ExpenseType) => {
    dispatchExpense({ type: "setExpenseType", value: newType });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAddExpense = () => {
    const payload = buildAddExpensePayload(expenseForm);
    if (!payload) return;

    addExpenseMutation.mutate(payload, {
      onSuccess: () => {
        resetForm();
        setShowAddForm(false);
      },
    });
  };

  const hasMatchBall = expenses.some((e) => e.expense_type === "match_ball");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            Expenses
            {totalExpenses > 0 && (
              <span className="ml-2 text-sm font-normal text-stone-500">
                (Total: {currencyFormatter.format(totalExpenses / 100)})
              </span>
            )}
          </span>
          {!isFinished && !showAddForm && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddForm(true)}
            >
              Add Expense
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Existing expenses */}
        {expenses.length === 0 ? (
          <p className="text-sm text-stone-500">No expenses recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {expenses.map((expense) => {
              const expenseId = expense.id;
              if (!expenseId) return null;
              return (
                <div
                  key={expenseId}
                  className="flex items-center justify-between rounded border border-stone-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {EXPENSE_TYPE_LABELS[expense.expense_type] ??
                          expense.expense_type}
                      </p>
                      {expense.description && (
                        <p className="text-xs text-stone-500">
                          {expense.description}
                        </p>
                      )}
                    </div>
                    {expense.receipt_image_url && (
                      <button
                        type="button"
                        className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        onClick={() =>
                          setViewingReceipt(expense.receipt_image_url)
                        }
                      >
                        Receipt
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {currencyFormatter.format(expense.amount_pence / 100)}
                    </span>
                    {!isFinished && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-800"
                        disabled={deleteExpenseMutation.isPending}
                        onClick={() => deleteExpenseMutation.mutate(expenseId)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add expense form */}
        {showAddForm && (
          <div className="mt-4 rounded border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-col gap-3">
              <div>
                <label
                  htmlFor="official-expense-type"
                  className="mb-1 block text-sm font-medium"
                >
                  Expense Type
                </label>
                <Select
                  value={expenseType}
                  onValueChange={(v) =>
                    handleExpenseTypeChange(v as ExpenseType)
                  }
                >
                  <SelectTrigger id="official-expense-type" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="umpire_fee">Umpire Fee</SelectItem>
                    <SelectItem value="scorer_fee">Scorer Fee</SelectItem>
                    {!hasMatchBall && (
                      <SelectItem value="match_ball">Match Ball</SelectItem>
                    )}
                    <SelectItem value="teas">Teas</SelectItem>
                    <SelectItem value="miscellaneous">Miscellaneous</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {expenseType === "match_ball" ? (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={matchBallUsed}
                      onChange={(e) =>
                        dispatchExpense({
                          type: "setMatchBallUsed",
                          value: e.target.checked,
                        })
                      }
                      className="rounded"
                    />
                    New match ball used
                  </label>
                  {matchBallUsed && (
                    <div>
                      <label
                        htmlFor="official-match-ball-cost"
                        className="mb-1 block text-sm font-medium"
                      >
                        Cost
                      </label>
                      <Input
                        id="official-match-ball-cost"
                        className="w-32"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={matchBallCost}
                        onChange={(e) =>
                          dispatchExpense({
                            type: "setMatchBallCost",
                            value: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="official-expense-description"
                      className="mb-1 block text-sm font-medium"
                    >
                      {expenseType === "umpire_fee"
                        ? "Umpire Name"
                        : expenseType === "scorer_fee"
                          ? "Scorer Name"
                          : expenseType === "miscellaneous"
                            ? "Description"
                            : "Description (optional)"}
                    </label>
                    <Input
                      id="official-expense-description"
                      placeholder={
                        expenseType === "umpire_fee"
                          ? "e.g. J. Smith"
                          : expenseType === "scorer_fee"
                            ? "e.g. A. Jones"
                            : "Description"
                      }
                      value={description}
                      onChange={(e) =>
                        dispatchExpense({
                          type: "setDescription",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="official-expense-amount"
                      className="mb-1 block text-sm font-medium"
                    >
                      Amount
                    </label>
                    <Input
                      id="official-expense-amount"
                      className="w-32"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) =>
                        dispatchExpense({
                          type: "setAmount",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              )}

              {/* Receipt image capture */}
              <div>
                <label
                  htmlFor="official-receipt-photo"
                  className="mb-1 block text-sm font-medium"
                >
                  Receipt Photo (optional)
                </label>
                <input
                  id="official-receipt-photo"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handleReceiptCapture(e)}
                  className="block w-full text-sm text-stone-500 file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-700 hover:file:bg-stone-200"
                />
                {compressing && (
                  <p className="mt-1 text-xs text-stone-500">
                    Processing image…
                  </p>
                )}
                {receiptPreview && (
                  <div className="mt-2">
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      className="h-24 w-auto rounded border border-stone-200 object-cover"
                    />
                    <button
                      type="button"
                      className="mt-1 text-xs text-red-600 hover:underline"
                      onClick={() => {
                        dispatchExpense({
                          type: "setReceipt",
                          preview: null,
                          dataUrl: null,
                        });
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleAddExpense}
                  disabled={
                    addExpenseMutation.isPending ||
                    compressing ||
                    (expenseType === "match_ball" ? !matchBallUsed : !amount)
                  }
                >
                  {addExpenseMutation.isPending ? "Adding…" : "Add"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
              </div>

              {addExpenseMutation.isError && (
                <p className="text-sm text-red-600">Failed to add expense.</p>
              )}
            </div>
          </div>
        )}

        {deleteExpenseMutation.isError && (
          <p className="mt-2 text-sm text-red-600">Failed to remove expense.</p>
        )}

        {/* Receipt image lightbox */}
        {viewingReceipt && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Receipt full size"
            tabIndex={-1}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setViewingReceipt(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                setViewingReceipt(null);
              }
            }}
          >
            <div
              role="presentation"
              className="relative max-h-[90vh] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={viewingReceipt}
                alt="Receipt"
                className="max-h-[85vh] max-w-full rounded-lg object-contain"
              />
              <button
                type="button"
                className="absolute -top-3 -right-3 rounded-full bg-white p-1.5 text-stone-800 shadow hover:bg-stone-100"
                onClick={() => setViewingReceipt(null)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
