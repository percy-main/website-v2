import { Badge } from "@/components/ui/badge";
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
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

// ── Types ──

interface AvailabilityRequest {
  id: string;
  date_from: string;
  date_to: string;
  status: string;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
  fixtureCount: number;
  respondentCount: number;
}

interface AvailabilityFixture {
  id: string;
  match_date: string;
  play_cricket_match_id: string;
  play_cricket_team_id: string;
  opposition: string;
  is_home: boolean;
  competition_name: string | null;
  match_time: string | null;
  team_name: string | null;
}

interface DateSummary {
  date: string;
  fixtures: AvailabilityFixture[];
  responseCount: number;
  assignmentCount: number;
}

interface RequestDetail {
  request: AvailabilityRequest;
  dates: DateSummary[];
}

interface PreviewFixture {
  matchDate: string;
  playCricketMatchId: string;
  teamName: string;
  opposition: string;
  isHome: boolean;
  competitionName: string | null;
  matchTime: string | null;
}

interface AvailabilityResponse {
  id: string;
  member_id: string;
  status: string;
  note: string | null;
  overridden_by: string | null;
  member_name: string | null;
}

interface Assignment {
  id: string;
  availability_fixture_id: string;
  member_id: string | null;
  player_name: string;
  position: number;
}

interface FixtureWithAssignments extends AvailabilityFixture {
  assignments: Assignment[];
}

interface MemberPool {
  id: string;
  name: string | null;
  member_category: string | null;
}

interface DateDetail {
  requestStatus: string;
  fixtures: FixtureWithAssignments[];
  pools: {
    available: AvailabilityResponse[];
    unavailable: AvailabilityResponse[];
    noResponse: MemberPool[];
  };
  assignedMemberIds: string[];
}

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
    queryFn: () =>
      api.get<{ items: AvailabilityRequest[] }>("/availability/requests"),
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between">
        <h1>Availability</h1>
        <div className="flex gap-2">
          {session?.user.role === "admin" && (
            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
              to="/admin"
            >
              Admin Panel
            </Link>
          )}
          <Link
            className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
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

      {query.isPending && <p className="mt-4 text-gray-500">Loading...</p>}
      {query.isError && (
        <p className="mt-4 text-red-600">Failed to load requests.</p>
      )}

      {query.data?.items.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-gray-500">
            No availability requests yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {(query.data?.items.length ?? 0) > 0 && query.data && (
        <div className="mt-4 flex flex-col gap-3">
          {query.data.items.map((req) => (
            <Link key={req.id} to={`/matchday/availability/${req.id}`}>
              <Card className="transition-colors hover:bg-gray-50">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-medium">
                      {format(new Date(req.date_from), "d MMM")} &ndash;{" "}
                      {format(new Date(req.date_to), "d MMM yyyy")}
                    </p>
                    <p className="text-sm text-gray-500">
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
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekFromNow = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(weekFromNow);

  const previewQuery = useQuery({
    queryKey: ["availability", "preview", dateFrom, dateTo],
    queryFn: () =>
      api.get<{ fixtures: PreviewFixture[] }>(
        `/availability/preview?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: dateFrom <= dateTo,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/availability/requests", { dateFrom, dateTo }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests"],
      });
      window.location.href = `/matchday/availability/${data.id}`;
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
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          &larr; Back
        </Link>
        <h1>New Availability Request</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">To</label>
              <Input
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
            <p className="text-sm text-gray-500">Loading fixtures...</p>
          )}

          {previewQuery.data?.fixtures.length === 0 && (
            <p className="text-sm text-gray-500">
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
                          <span className="text-gray-500">
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
            {createMutation.isPending ? "Creating..." : "Create Request"}
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
      api.get<RequestDetail>(`/availability/requests/${requestId}`),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/availability/requests/${requestId}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId],
      });
    },
  });

  if (query.isPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
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
          className="text-sm text-gray-500 hover:text-gray-900"
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

      <div className="mb-4">
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
      </div>

      {dates.length === 0 && (
        <p className="text-gray-500">No fixture dates in this request.</p>
      )}

      <div className="flex flex-col gap-3">
        {dates.map((d) => (
          <Link
            key={d.date}
            to={`/matchday/availability/${requestId}/${d.date}`}
          >
            <Card className="transition-colors hover:bg-gray-50">
              <CardContent className="py-4">
                <p className="font-medium">
                  {format(new Date(d.date), "EEEE d MMMM yyyy")}
                </p>
                <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-500">
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
                        <span className="text-gray-400">
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
      api.get<DateDetail>(`/availability/requests/${requestId}/dates/${date}`),
  });

  const assignMutation = useMutation({
    mutationFn: (data: {
      fixtureId: string;
      memberId?: string;
      playerName: string;
    }) =>
      api.post(
        `/availability/requests/${requestId}/dates/${date}/assign`,
        data,
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
      api.delete(`/availability/assignments/${assignmentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId, "dates", date],
      });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: (data: { responseId: string; status: string }) =>
      api.put(`/availability/responses/${data.responseId}/override`, {
        status: data.status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId, "dates", date],
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.post(`/availability/requests/${requestId}/dates/${date}/confirm`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests", requestId],
      });
    },
  });

  if (query.isPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
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
          className="text-sm text-gray-500 hover:text-gray-900"
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
                  <span className="text-sm font-normal text-gray-400">
                    {fixture.assignments.length}/11
                  </span>
                </CardTitle>
                <p className="text-sm text-gray-500">
                  {fixture.is_home ? "vs" : "@"} {fixture.opposition}
                  {fixture.competition_name && ` (${fixture.competition_name})`}
                  {fixture.match_time && ` · ${fixture.match_time}`}
                </p>
              </CardHeader>
              <CardContent>
                {fixture.assignments.length === 0 ? (
                  <p className="text-sm text-gray-400">No players assigned</p>
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
                            <span className="ml-1 text-xs text-gray-400">
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
              ? "Confirming..."
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
            placeholder="Search players..."
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
              responseId: p.id,
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
            onOverride={(responseId, status) =>
              overrideMutation.mutate({ responseId, status })
            }
            overrideStatus="unavailable"
            isAssigning={assignMutation.isPending}
          />

          {/* Unavailable pool */}
          <PlayerPool
            title="Unavailable"
            badgeColor="bg-red-100 text-red-800"
            players={pools.unavailable
              .filter((p) =>
                (p.member_name ?? "").toLowerCase().includes(searchLower),
              )
              .map((p) => ({
                id: p.member_id,
                name: p.member_name ?? "Unknown",
                note: p.note,
                responseId: p.id,
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
            onOverride={(responseId, status) =>
              overrideMutation.mutate({ responseId, status })
            }
            overrideStatus="available"
            isAssigning={assignMutation.isPending}
          />

          {/* No Response pool */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                No Response
                <Badge variant="outline" className="bg-gray-100 text-gray-600">
                  {filteredNoResponse.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredNoResponse.length === 0 ? (
                <p className="text-sm text-gray-400">None</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredNoResponse.slice(0, 50).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{p.name ?? "Unknown"}</span>
                      {fixtures.length === 1 ? (
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800"
                          disabled={
                            assignMutation.isPending ||
                            fixtures[0].assignments.length >= 11
                          }
                          onClick={() =>
                            assignMutation.mutate({
                              fixtureId: fixtures[0].id,
                              memberId: p.id,
                              playerName: p.name ?? "Unknown",
                            })
                          }
                        >
                          Assign
                        </button>
                      ) : (
                        <FixtureSelect
                          fixtures={fixtures}
                          onSelect={(fixtureId) =>
                            assignMutation.mutate({
                              fixtureId,
                              memberId: p.id,
                              playerName: p.name ?? "Unknown",
                            })
                          }
                          disabled={assignMutation.isPending}
                        />
                      )}
                    </div>
                  ))}
                  {filteredNoResponse.length > 50 && (
                    <p className="text-xs text-gray-400">
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
  onOverride,
  overrideStatus,
  isAssigning,
}: {
  title: string;
  badgeColor: string;
  players: Array<{
    id: string;
    name: string;
    note: string | null;
    responseId: string;
    overridden: boolean;
  }>;
  fixtures: FixtureWithAssignments[];
  onAssign: (fixtureId: string, memberId: string, name: string) => void;
  onOverride: (responseId: string, status: string) => void;
  overrideStatus: string;
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
          <p className="text-sm text-gray-400">None</p>
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
                    <span className="ml-2 text-xs text-gray-400">{p.note}</span>
                  )}
                  {p.overridden && (
                    <span className="ml-1 text-xs text-amber-500">
                      (overridden)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-gray-400 hover:text-gray-600"
                    onClick={() => onOverride(p.responseId, overrideStatus)}
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
