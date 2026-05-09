import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen.js";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useCallback, useReducer, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  buildPreviewPayload,
  buildSendRecipients,
  initialNotifyFormState,
  notifyFormReducer,
} from "./availability.reducer";

// ── Derived API types ──

type ApiResponse<P extends keyof paths, M extends string = "get"> =
  paths[P] extends Record<
    M,
    { responses: { 200: { content: { "application/json": infer R } } } }
  >
    ? R
    : never;

type PreviewData = ApiResponse<"/api/availability/preview">;
type PreviewFixture = PreviewData["fixtures"][number];

type DateDetailData =
  ApiResponse<"/api/availability/requests/{requestId}/dates/{date}">;
type FixtureWithAssignments = DateDetailData["fixtures"][number];

// ── Main Component ──

export function Component() {
  useDocumentMeta("Availability");
  const { data: session } = useSession();
  const { requestId, date } = useParams();
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view");

  if (!session) return null;

  if (date && requestId) {
    return <TeamSelectionView requestId={requestId} date={date} />;
  }

  if (requestId) {
    return <RequestDetailView requestId={requestId} />;
  }

  if (view === "new") {
    return <CreateRequestView />;
  }

  return <RequestListView />;
}

// ── Request List ──

function RequestListView() {
  const { data: session } = useSession();
  const query = useQuery({
    queryKey: ["availability", "requests"],
    queryFn: () => callApi(api.GET("/api/availability/requests")),
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between">
        <h1>Availability</h1>
        <div className="flex gap-2">
          {session?.user.role === "admin" && (
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
          <Link
            className="bg-dark text-body rounded px-4 py-2 text-sm hover:opacity-90"
            to="/matchday/availability?view=new"
          >
            New Request
          </Link>
        </div>
      </div>

      {query.isPending && <p className="mt-4 text-stone-500">Loading…</p>}
      {query.isError && (
        <p className="mt-4 text-red-600">Failed to load requests.</p>
      )}

      {query.data?.items.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-stone-500">
            No availability requests yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {(query.data?.items.length ?? 0) > 0 && query.data && (
        <div className="mt-4 flex flex-col gap-3">
          {query.data.items.map((req) => (
            <Link key={req.id} to={`/matchday/availability/${req.id}`}>
              <Card className="transition-colors hover:bg-stone-50">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-medium">
                      {format(new Date(req.date_from), "d MMM")} &ndash;{" "}
                      {format(new Date(req.date_to), "d MMM yyyy")}
                    </p>
                    <p className="text-sm text-stone-500">
                      {req.fixtureCount} fixture
                      {req.fixtureCount !== 1 ? "s" : ""} &middot;{" "}
                      {req.respondentCount} responded
                      {req.created_by_name &&
                        ` · Created by ${req.created_by_name}`}
                    </p>
                  </div>
                  <Badge
                    variant={req.status === "open" ? "default" : "secondary"}
                  >
                    {req.status}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create Request ──

function CreateRequestView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekFromNow = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(weekFromNow);

  const previewQuery = useQuery({
    queryKey: ["availability", "preview", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/preview", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
    enabled: dateFrom <= dateTo,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/availability/requests", {
          body: { dateFrom, dateTo },
        }),
      ),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests"],
      });
      void navigate(`/matchday/availability/${data.id}`);
    },
  });

  // Group preview fixtures by date
  const fixturesByDate = new Map<string, PreviewFixture[]>();
  for (const f of previewQuery.data?.fixtures ?? []) {
    const list = fixturesByDate.get(f.matchDate) ?? [];
    list.push(f);
    fixturesByDate.set(f.matchDate, list);
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/matchday/availability"
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          &larr; Back
        </Link>
        <h1>New Availability Request</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label
                htmlFor="availability-new-date-from"
                className="mb-1 block text-sm font-medium"
              >
                From
              </label>
              <Input
                id="availability-new-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="availability-new-date-to"
                className="mb-1 block text-sm font-medium"
              >
                To
              </label>
              <Input
                id="availability-new-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {dateFrom > dateTo && (
            <p className="text-sm text-red-600">
              "From" date must be before "To" date.
            </p>
          )}

          {previewQuery.isPending && (
            <p className="text-sm text-stone-500">Loading fixtures…</p>
          )}

          {previewQuery.data?.fixtures.length === 0 && (
            <p className="text-sm text-stone-500">
              No senior fixtures found in this date range.
            </p>
          )}

          {fixturesByDate.size > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">
                {previewQuery.data?.fixtures.length} fixture
                {(previewQuery.data?.fixtures.length ?? 0) !== 1
                  ? "s"
                  : ""}{" "}
                found:
              </p>
              {Array.from(fixturesByDate.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, fixtures]) => (
                  <div key={date} className="rounded border p-3">
                    <p className="mb-1 text-sm font-semibold">
                      {format(new Date(date), "EEEE d MMMM yyyy")}
                    </p>
                    {fixtures.map((f) => (
                      <p key={f.playCricketMatchId} className="text-sm">
                        {f.teamName} {f.isHome ? "vs" : "@"} {f.opposition}
                        {f.competitionName && (
                          <span className="text-stone-500">
                            {" "}
                            ({f.competitionName})
                          </span>
                        )}
                      </p>
                    ))}
                  </div>
                ))}
            </div>
          )}

          <Button
            onClick={() => createMutation.mutate()}
            disabled={
              createMutation.isPending ||
              dateFrom > dateTo ||
              (previewQuery.data?.fixtures.length ?? 0) === 0
            }
            className="self-start"
          >
            {createMutation.isPending ? "Creating…" : "Create Request"}
          </Button>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error.message.includes("409")
                ? "An availability request already overlaps with this date range."
                : "Failed to create request. Please try again."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Request Detail ──

function RequestDetailView({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["availability", "requests", requestId],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests/{requestId}", {
          params: { path: { requestId } },
        }),
      ),
  });

  const statusMutation = useMutation({
    mutationFn: (status: "open" | "closed") =>
      callApi(
        api.PATCH("/api/availability/requests/{requestId}", {
          params: { path: { requestId } },
          body: { status },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId],
      });
    },
  });

  if (query.isPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-red-600">Failed to load request.</p>
      </div>
    );
  }

  const { request, dates } = query.data;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/matchday/availability"
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          &larr; Back
        </Link>
        <h1>
          {format(new Date(request.date_from), "d MMM")} &ndash;{" "}
          {format(new Date(request.date_to), "d MMM yyyy")}
        </h1>
        <Badge
          variant={request.status === "open" ? "default" : "secondary"}
          className="ml-2"
        >
          {request.status}
        </Badge>
      </div>

      <div className="mb-4 flex gap-2">
        {request.status === "open" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => statusMutation.mutate("closed")}
            disabled={statusMutation.isPending}
          >
            Close Request
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => statusMutation.mutate("open")}
            disabled={statusMutation.isPending}
          >
            Reopen Request
          </Button>
        )}
        <NotifyDialog requestId={requestId} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = `${window.location.origin}/availability/${requestId}`;
            void navigator.clipboard.writeText(url);
          }}
        >
          Copy Link
        </Button>
      </div>

      {dates.length === 0 && (
        <p className="text-stone-500">No fixture dates in this request.</p>
      )}

      <div className="flex flex-col gap-3">
        {dates.map((d) => (
          <Link
            key={d.date}
            to={`/matchday/availability/${requestId}/${d.date}`}
          >
            <Card className="transition-colors hover:bg-stone-50">
              <CardContent className="py-4">
                <p className="font-medium">
                  {format(new Date(d.date), "EEEE d MMMM yyyy")}
                </p>
                <div className="mt-1 flex flex-wrap gap-4 text-sm text-stone-500">
                  <span>
                    {d.fixtures.length} fixture
                    {d.fixtures.length !== 1 ? "s" : ""}
                  </span>
                  <span>{d.responseCount} responded</span>
                  <span>{d.assignmentCount} assigned</span>
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {d.fixtures.map((f) => (
                    <p key={f.id} className="text-sm">
                      {f.opposition}
                      {f.competition_name && (
                        <span className="text-stone-400">
                          {" "}
                          ({f.competition_name})
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Team Selection View ──

function TeamSelectionView({
  requestId,
  date,
}: {
  requestId: string;
  date: string;
}) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");

  const query = useQuery({
    queryKey: ["availability", "requests", requestId, "dates", date],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests/{requestId}/dates/{date}", {
          params: { path: { requestId, date } },
        }),
      ),
  });

  const assignMutation = useMutation({
    mutationFn: (data: {
      fixtureId: string;
      memberId?: string;
      playerName: string;
    }) =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/dates/{date}/assign", {
          params: { path: { requestId, date } },
          body: data,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId, "dates", date],
      });
      setAssigningTo(null);
      setGuestName("");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      callApi(
        api.DELETE("/api/availability/assignments/{assignmentId}", {
          params: { path: { assignmentId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId, "dates", date],
      });
    },
  });

  const setAvailabilityMutation = useMutation({
    mutationFn: (data: {
      memberId: string;
      status: "available" | "unavailable";
    }) =>
      callApi(
        api.PUT(
          "/api/availability/requests/{requestId}/dates/{date}/members/{memberId}/availability",
          {
            params: {
              path: { requestId, date, memberId: data.memberId },
            },
            body: { status: data.status },
          },
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId, "dates", date],
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST(
          "/api/availability/requests/{requestId}/dates/{date}/confirm",
          {
            params: { path: { requestId, date } },
          },
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId],
      });
    },
  });

  if (query.isPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-red-600">Failed to load date detail.</p>
      </div>
    );
  }

  const { fixtures, pools, assignedMemberIds } = query.data;
  const assignedSet = new Set(assignedMemberIds);

  // Filter available players by search term
  const searchLower = searchTerm.toLowerCase();
  const filteredAvailable = pools.available.filter(
    (p) =>
      !assignedSet.has(p.member_id) &&
      (p.member_name ?? "").toLowerCase().includes(searchLower),
  );
  const filteredNoResponse = pools.noResponse.filter(
    (p) =>
      !assignedSet.has(p.id) &&
      (p.name ?? "").toLowerCase().includes(searchLower),
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to={`/matchday/availability/${requestId}`}
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          &larr; Back
        </Link>
        <h1>{format(new Date(date), "EEEE d MMMM yyyy")}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Fixture cards with assignments */}
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Fixtures</h2>
          {fixtures.map((fixture) => (
            <Card key={fixture.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {fixture.team_name ?? "Unknown Team"}
                  <span className="text-sm font-normal text-stone-400">
                    {fixture.assignments.length}/11
                  </span>
                </CardTitle>
                <p className="text-sm text-stone-500">
                  {fixture.is_home ? "vs" : "@"} {fixture.opposition}
                  {fixture.competition_name && ` (${fixture.competition_name})`}
                  {fixture.match_time && ` · ${fixture.match_time}`}
                </p>
              </CardHeader>
              <CardContent>
                {fixture.assignments.length === 0 ? (
                  <p className="text-sm text-stone-400">No players assigned</p>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {fixture.assignments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>
                          {a.position}. {a.player_name}
                          {!a.member_id && (
                            <span className="ml-1 text-xs text-stone-400">
                              (guest)
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => removeMutation.mutate(a.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                          disabled={removeMutation.isPending}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Under-11 warning */}
          {fixtures.some(
            (f) => f.assignments.length > 0 && f.assignments.length < 11,
          ) && (
            <p className="text-sm text-amber-600">
              Warning: some teams have fewer than 11 players assigned.
            </p>
          )}

          {/* Confirm button */}
          <Button
            onClick={() => confirmMutation.mutate()}
            disabled={
              confirmMutation.isPending ||
              fixtures.every((f) => f.assignments.length === 0)
            }
          >
            {confirmMutation.isPending
              ? "Confirming…"
              : "Confirm Teams \u2192 Create Matchdays"}
          </Button>
          {confirmMutation.isSuccess && (
            <p className="text-sm text-green-600">
              Matchday records created. View them in the{" "}
              <Link to="/matchday/teams" className="underline">
                Team Management
              </Link>
              .
            </p>
          )}
          {confirmMutation.isError && (
            <p className="text-sm text-red-600">
              {confirmMutation.error.message.includes("409")
                ? "A matchday already exists for one of these fixtures."
                : "Failed to confirm. Please try again."}
            </p>
          )}
        </div>

        {/* Right: Player pools */}
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Players</h2>

          <Input
            placeholder="Search players…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {/* Guest player entry */}
          <Card>
            <CardContent className="flex gap-2 py-3">
              <Input
                placeholder="Add non-member by name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
              <Select value={assigningTo ?? ""} onValueChange={setAssigningTo}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Fixture" />
                </SelectTrigger>
                <SelectContent>
                  {fixtures.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.team_name ?? "Team"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={
                  !guestName.trim() || !assigningTo || assignMutation.isPending
                }
                onClick={() => {
                  if (assigningTo && guestName.trim()) {
                    assignMutation.mutate({
                      fixtureId: assigningTo,
                      playerName: guestName.trim(),
                    });
                  }
                }}
              >
                Add
              </Button>
            </CardContent>
          </Card>

          {/* Available pool */}
          <PlayerPool
            title="Available"
            badgeColor="bg-green-100 text-green-800"
            players={filteredAvailable.map((p) => ({
              id: p.member_id,
              name: p.member_name ?? "Unknown",
              note: p.note,
              overridden: !!p.overridden_by,
            }))}
            fixtures={fixtures}
            onAssign={(fixtureId, memberId, name) =>
              assignMutation.mutate({
                fixtureId,
                memberId,
                playerName: name,
              })
            }
            onSetAvailability={(memberId, status) =>
              setAvailabilityMutation.mutate({ memberId, status })
            }
            overrideStatus="unavailable"
            isAssigning={assignMutation.isPending}
          />

          {/* Unavailable pool */}
          <PlayerPool
            title="Unavailable"
            badgeColor="bg-red-100 text-red-800"
            players={pools.unavailable.flatMap((p) =>
              (p.member_name ?? "").toLowerCase().includes(searchLower)
                ? [
                    {
                      id: p.member_id,
                      name: p.member_name ?? "Unknown",
                      note: p.note,
                      overridden: !!p.overridden_by,
                    },
                  ]
                : [],
            )}
            fixtures={fixtures}
            onAssign={(fixtureId, memberId, name) =>
              assignMutation.mutate({
                fixtureId,
                memberId,
                playerName: name,
              })
            }
            onSetAvailability={(memberId, status) =>
              setAvailabilityMutation.mutate({ memberId, status })
            }
            overrideStatus="available"
            isAssigning={assignMutation.isPending}
          />

          {/* No Response pool */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                No Response
                <Badge variant="outline" className="bg-stone-100 text-stone-600">
                  {filteredNoResponse.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredNoResponse.length === 0 ? (
                <p className="text-sm text-stone-400">None</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredNoResponse.slice(0, 50).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{p.name ?? "Unknown"}</span>
                      <div className="flex gap-2">
                        <button
                          className="text-xs text-green-700 hover:text-green-900"
                          disabled={setAvailabilityMutation.isPending}
                          onClick={() =>
                            setAvailabilityMutation.mutate({
                              memberId: p.id,
                              status: "available",
                            })
                          }
                        >
                          Available
                        </button>
                        <button
                          className="text-xs text-red-600 hover:text-red-800"
                          disabled={setAvailabilityMutation.isPending}
                          onClick={() =>
                            setAvailabilityMutation.mutate({
                              memberId: p.id,
                              status: "unavailable",
                            })
                          }
                        >
                          Unavailable
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredNoResponse.length > 50 && (
                    <p className="text-xs text-stone-400">
                      +{filteredNoResponse.length - 50} more
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ──

function PlayerPool({
  title,
  badgeColor,
  players,
  fixtures,
  onAssign,
  onSetAvailability,
  overrideStatus,
  isAssigning,
}: {
  title: string;
  badgeColor: string;
  players: Array<{
    id: string;
    name: string;
    note: string | null;
    overridden: boolean;
  }>;
  fixtures: FixtureWithAssignments[];
  onAssign: (fixtureId: string, memberId: string, name: string) => void;
  onSetAvailability: (
    memberId: string,
    status: "available" | "unavailable",
  ) => void;
  overrideStatus: "available" | "unavailable";
  isAssigning: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {title}
          <Badge variant="outline" className={badgeColor}>
            {players.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <p className="text-sm text-stone-400">None</p>
        ) : (
          <div className="flex flex-col gap-1">
            {players.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm"
              >
                <div>
                  <span>{p.name}</span>
                  {p.note && (
                    <span className="ml-2 text-xs text-stone-400">{p.note}</span>
                  )}
                  {p.overridden && (
                    <span className="ml-1 text-xs text-amber-500">
                      (overridden)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-stone-400 hover:text-stone-600"
                    onClick={() => onSetAvailability(p.id, overrideStatus)}
                  >
                    {overrideStatus === "available"
                      ? "Mark available"
                      : "Mark unavailable"}
                  </button>
                  {fixtures.length === 1 ? (
                    <button
                      className="text-xs text-blue-600 hover:text-blue-800"
                      disabled={
                        isAssigning || fixtures[0].assignments.length >= 11
                      }
                      onClick={() => onAssign(fixtures[0].id, p.id, p.name)}
                    >
                      Assign
                    </button>
                  ) : (
                    <FixtureSelect
                      fixtures={fixtures}
                      onSelect={(fixtureId) =>
                        onAssign(fixtureId, p.id, p.name)
                      }
                      disabled={isAssigning}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Notify Dialog ──

function NotifyDialog({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [form, dispatch] = useReducer(
    notifyFormReducer,
    initialNotifyFormState,
  );
  const {
    memberCategory,
    membershipStatus,
    manualEmails,
    recipients,
    checked,
    previewed,
  } = form;

  // Fire-and-forget: returns a recipient preview into local state; no cached
  // queries to invalidate.
  const previewMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/notify/preview", {
          params: { path: { requestId } },
          body: buildPreviewPayload(form),
        }),
      ),
    onSuccess: (data) => {
      dispatch({ type: "previewSucceeded", recipients: data.recipients });
    },
  });

  // Fire-and-forget: dispatches notification emails; no cached data changes.
  const sendMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/notify/send", {
          params: { path: { requestId } },
          body: { recipients: buildSendRecipients(form) },
        }),
      ),
    onSuccess: () => {
      // Keep dialog open to show success
    },
  });

  const toggleRecipient = useCallback((email: string) => {
    dispatch({ type: "toggleRecipient", email });
  }, []);

  const toggleAll = useCallback(() => {
    dispatch({ type: "toggleAll" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    sendMutation.reset();
    previewMutation.reset();
  }, [sendMutation, previewMutation]);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Notify Members
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v: boolean) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-h-[80vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notify Members</DialogTitle>
          </DialogHeader>

          {sendMutation.isSuccess ? (
            <div className="space-y-3">
              <p className="text-sm text-green-600">
                Sent {sendMutation.data.sent} email
                {sendMutation.data.sent !== 1 ? "s" : ""}.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          ) : !previewed ? (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="notify-member-category"
                  className="mb-1 block text-sm font-medium"
                >
                  Member Category
                </label>
                <Select
                  value={memberCategory || "__all__"}
                  onValueChange={(v) =>
                    dispatch({
                      type: "setMemberCategory",
                      value: v === "__all__" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger id="notify-member-category">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All categories</SelectItem>
                    <SelectItem value="senior">Senior</SelectItem>
                    <SelectItem value="junior">Junior</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="bursary">Bursary</SelectItem>
                    <SelectItem value="guest">Guest</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label
                  htmlFor="notify-membership-status"
                  className="mb-1 block text-sm font-medium"
                >
                  Membership Status
                </label>
                <Select
                  value={membershipStatus || "__any__"}
                  onValueChange={(v) =>
                    dispatch({
                      type: "setMembershipStatus",
                      value: v === "__any__" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger id="notify-membership-status">
                    <SelectValue placeholder="Any status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any status</SelectItem>
                    <SelectItem value="active">Active (paid up)</SelectItem>
                    <SelectItem value="lapsed">Lapsed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label
                  htmlFor="notify-additional-emails"
                  className="mb-1 block text-sm font-medium"
                >
                  Additional Emails
                </label>
                <Input
                  id="notify-additional-emails"
                  placeholder="email1@example.com, email2@example.com"
                  value={manualEmails}
                  onChange={(e) =>
                    dispatch({
                      type: "setManualEmails",
                      value: e.target.value,
                    })
                  }
                />
                <p className="mt-1 text-xs text-stone-500">
                  Comma-separated. These will be added to the filtered list.
                </p>
              </div>

              <Button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
              >
                {previewMutation.isPending
                  ? "Loading…"
                  : "Preview Recipients"}
              </Button>

              {previewMutation.isError && (
                <p className="text-sm text-red-600">
                  Failed to load recipients.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {checked.size} of {recipients.length} selected
                </p>
                <button
                  className="text-xs text-blue-600 hover:text-blue-800"
                  onClick={toggleAll}
                >
                  {checked.size === recipients.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto rounded border">
                {recipients.map((r) => (
                  <label
                    key={r.email}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-stone-50"
                  >
                    <Checkbox
                      checked={checked.has(r.email)}
                      onCheckedChange={() => toggleRecipient(r.email)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {r.name ?? r.email}
                        {r.source === "manual" && (
                          <span className="ml-1 text-xs text-stone-400">
                            (manual)
                          </span>
                        )}
                      </p>
                      {r.name && (
                        <p className="truncate text-xs text-stone-500">
                          {r.email}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending || checked.size === 0}
                >
                  {sendMutation.isPending
                    ? "Sending…"
                    : `Send to ${checked.size} recipient${checked.size !== 1 ? "s" : ""}`}
                </Button>
                <Button variant="outline" onClick={reset}>
                  Back
                </Button>
              </div>

              {sendMutation.isError && (
                <p className="text-sm text-red-600">
                  Failed to send notifications.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FixtureSelect({
  fixtures,
  onSelect,
  disabled,
}: {
  fixtures: FixtureWithAssignments[];
  onSelect: (fixtureId: string) => void;
  disabled: boolean;
}) {
  return (
    <Select onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger className="h-6 w-28 text-xs">
        <SelectValue placeholder="Assign to" />
      </SelectTrigger>
      <SelectContent>
        {fixtures.map((f) => (
          <SelectItem
            key={f.id}
            value={f.id}
            disabled={f.assignments.length >= 11}
          >
            {f.team_name ?? "Team"} ({f.assignments.length}/11)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
