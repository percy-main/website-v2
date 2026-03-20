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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

// ── Types ──

interface AvailabilityRequest {
  id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  gameDates: string[];
  totalDates: number;
  totalAvailable: number;
  totalMaybe: number;
  totalUnavailable: number;
  totalResponses: number;
  matchdays: Array<{
    id: string;
    match_date: string;
    opposition: string;
    play_cricket_team_id: string;
  }>;
}

interface PlayCricketFixture {
  matchId: string;
  matchDate: string;
  opposition: string;
  teamId: string;
  teamName: string;
  isHome: boolean;
  competitionType: string | null;
}

interface RequestDetail {
  id: string;
  start_date: string;
  end_date: string;
  dates: Array<{
    matchDate: string;
    availabilityDateIds: string[];
    fixtures: PlayCricketFixture[];
    available: number;
    maybe: number;
    unavailable: number;
    totalResponses: number;
    assignments: number;
  }>;
}

interface PreviewData {
  fixtures: PlayCricketFixture[];
  overlapping: boolean;
}

interface GridData {
  matchDate: string;
  availabilityDateIds: string[];
  matchdays: Array<{
    id: string;
    opposition: string;
    status: string;
    play_cricket_team_id: string;
    team_name: string | null;
  }>;
  grid: GridRow[];
}

interface GridRow {
  memberId: string;
  memberName: string | null;
  memberCategory: string | null;
  availabilityStatus: string | null;
  availabilityNotes: string | null;
  declaredAt: string | null;
  assignments: Array<{
    assignmentId: string;
    matchdayId: string;
    opposition: string | null;
    teamName: string | null;
  }>;
}

// ── Status helpers ──

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  unavailable: "bg-red-100 text-red-800",
  maybe: "bg-yellow-100 text-yellow-800",
};

const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  unavailable: "Unavailable",
  maybe: "Maybe",
};

// ── Root page (list or member view) ──

export function Component() {
  const { data: session } = useSession();
  if (!session) return null;

  const { user } = session;
  const isOfficial = user.role === "official" || user.role === "admin";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1>Availability</h1>
          <div className="flex gap-2">
            {isOfficial && (
              <Link
                className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
                to="/official"
              >
                Official Panel
              </Link>
            )}
            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
              to="/members"
            >
              Members Area
            </Link>
          </div>
        </div>

        {isOfficial ? <RequestListView /> : <MemberAvailability />}
      </div>
    </div>
  );
}

// ── Member view ──

interface MyAvailabilityData {
  memberId: string | null;
  dates: Array<{
    id: string;
    match_date: string;
    play_cricket_team_id: string;
    team_name: string | null;
    myStatus: string | null;
    myNotes: string | null;
    myAssignments: Array<{ matchday_id: string; opposition: string | null }>;
    matchdays: Array<{
      id: string;
      opposition: string;
      play_cricket_team_id: string;
    }>;
  }>;
}

function MemberAvailability() {
  const queryClient = useQueryClient();

  const myQuery = useQuery({
    queryKey: ["availability", "me"],
    queryFn: () => api.get<MyAvailabilityData>("/availability/me"),
  });

  const declareMutation = useMutation({
    mutationFn: (input: { dateId: string; status: string; notes?: string }) =>
      api.post(`/availability/dates/${input.dateId}/declare`, {
        status: input.status,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "me"],
      });
    },
  });

  if (myQuery.isPending) return <p className="text-gray-500">Loading...</p>;
  if (myQuery.isError) return <p className="text-red-600">Failed to load.</p>;

  const data = myQuery.data;

  if (!data?.memberId) {
    return (
      <p className="text-gray-500">
        No member record linked to your account. Contact an admin.
      </p>
    );
  }

  if (data.dates.length === 0) {
    return (
      <p className="text-gray-500">
        No availability requests at the moment. Check back later.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {data.dates.map((date) => (
        <MemberDateCard
          key={date.id}
          date={date}
          declareMutation={declareMutation}
        />
      ))}
    </div>
  );
}

function MemberDateCard({
  date,
  declareMutation,
}: {
  date: MyAvailabilityData["dates"][number];
  declareMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { dateId: string; status: string; notes?: string }
    >
  >;
}) {
  const [notes, setNotes] = useState(date.myNotes ?? "");
  const [showNotes, setShowNotes] = useState(false);

  const handleDeclare = (status: string) => {
    declareMutation.mutate({
      dateId: date.id,
      status,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div>
            <span>{format(new Date(date.match_date), "EEEE d MMMM yyyy")}</span>
            {date.team_name && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                {date.team_name}
              </span>
            )}
          </div>
          {date.myStatus && (
            <Badge
              className={STATUS_COLORS[date.myStatus] ?? ""}
              variant="outline"
            >
              {STATUS_LABELS[date.myStatus] ?? date.myStatus}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {date.matchdays.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-sm font-medium text-gray-600">Fixtures:</p>
            {date.matchdays.map((md) => (
              <p key={md.id} className="text-sm text-gray-500">
                vs {md.opposition}
              </p>
            ))}
          </div>
        )}
        {date.myAssignments.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-sm font-medium text-green-700">
              You have been selected:
            </p>
            {date.myAssignments.map((a) => (
              <p key={a.matchday_id} className="text-sm text-green-600">
                vs {a.opposition}
              </p>
            ))}
          </div>
        )}
        {showNotes ? (
          <div className="mb-3">
            <Textarea
              placeholder="Add a note (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mb-2"
              rows={2}
            />
          </div>
        ) : (
          <button
            type="button"
            className="mb-3 text-sm text-gray-400 hover:text-gray-600"
            onClick={() => setShowNotes(true)}
          >
            Add a note...
          </button>
        )}
        <div className="flex gap-2">
          {(["available", "maybe", "unavailable"] as const).map((status) => (
            <Button
              key={status}
              size="sm"
              variant={date.myStatus === status ? "default" : "outline"}
              className={
                date.myStatus === status
                  ? status === "available"
                    ? "bg-green-600 hover:bg-green-700"
                    : status === "maybe"
                      ? "bg-yellow-500 hover:bg-yellow-600"
                      : "bg-red-600 hover:bg-red-700"
                  : ""
              }
              disabled={declareMutation.isPending}
              onClick={() => handleDeclare(status)}
            >
              {STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
        {declareMutation.isError && (
          <p className="mt-2 text-sm text-red-600">
            Failed to update availability.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Request list (official landing) ──

function RequestListView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const requestsQuery = useQuery({
    queryKey: ["availability", "requests"],
    queryFn: () => api.get<AvailabilityRequest[]>("/availability/requests"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/availability/requests/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "requests"],
      });
    },
  });

  const requests = requestsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Availability Requests</h2>
        <Button onClick={() => void navigate("/availability/requests/new")}>
          New Request
        </Button>
      </div>

      {requestsQuery.isPending && <p className="text-gray-500">Loading...</p>}

      {requests.length === 0 && !requestsQuery.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-2 text-gray-500">No availability requests yet.</p>
            <p className="text-sm text-gray-400">
              Create a request to ask players for their availability.
            </p>
          </CardContent>
        </Card>
      )}

      {requests.map((req) => (
        <Card
          key={req.id}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => void navigate(`/availability/requests/${req.id}`)}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                {format(new Date(req.start_date), "d MMM")} —{" "}
                {format(new Date(req.end_date), "d MMM yyyy")}
              </p>
              <div className="flex gap-2 text-sm">
                {req.totalResponses > 0 ? (
                  <>
                    <span className="text-green-600">
                      {req.totalAvailable} available
                    </span>
                    {req.totalMaybe > 0 && (
                      <span className="text-yellow-600">
                        {req.totalMaybe} maybe
                      </span>
                    )}
                    {req.totalUnavailable > 0 && (
                      <span className="text-red-600">
                        {req.totalUnavailable} unavailable
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400">No responses yet</span>
                )}
              </div>
              <p className="text-xs text-gray-400">
                {req.gameDates.length} game date
                {req.gameDates.length !== 1 ? "s" : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:text-red-800"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                deleteMutation.mutate(req.id);
              }}
            >
              Delete
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Create request page (URL: /availability/requests/new) ──

export function CreateRequestPage() {
  const navigate = useNavigate();
  const today = format(new Date(), "yyyy-MM-dd");
  const defaultEnd = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEnd);

  const previewQuery = useQuery({
    queryKey: ["availability", "preview", startDate, endDate],
    queryFn: () =>
      api.get<PreviewData>(
        `/availability/preview?startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!startDate && !!endDate && startDate <= endDate,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/availability/requests", {
        startDate,
        endDate,
      }),
    onSuccess: (data) => {
      if (data?.id) void navigate(`/availability/requests/${data.id}`);
    },
  });

  const preview = previewQuery.data;
  const gamesByDate = new Map<string, PlayCricketFixture[]>();
  if (preview) {
    for (const f of preview.fixtures) {
      const arr = gamesByDate.get(f.matchDate) ?? [];
      arr.push(f);
      gamesByDate.set(f.matchDate, arr);
    }
  }
  const sortedDates = [...gamesByDate.keys()].sort();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate("/availability")}
          >
            Back
          </Button>
          <h2 className="text-xl font-semibold">New Availability Request</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date Range</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">From</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">To</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {preview?.overlapping && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-red-800">
                This date range overlaps with an existing availability request.
              </p>
            </CardContent>
          </Card>
        )}

        {previewQuery.isPending && (
          <p className="text-gray-500">Loading games...</p>
        )}

        {preview && !preview.overlapping && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Games in this window ({preview.fixtures.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sortedDates.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No games found in this date range.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {sortedDates.map((date) => {
                    const games = gamesByDate.get(date) ?? [];
                    return (
                      <div key={date}>
                        <p className="text-sm font-medium">
                          {format(new Date(date), "EEEE d MMMM yyyy")}
                        </p>
                        {games.map((g) => (
                          <p key={g.matchId} className="text-sm text-gray-500">
                            {g.teamName} vs {g.opposition}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {preview && !preview.overlapping && (
          <Button
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? "Creating..."
              : `Send Availability Request (${sortedDates.length} date${sortedDates.length !== 1 ? "s" : ""})`}
          </Button>
        )}

        {createMutation.isError && (
          <p className="text-sm text-red-600">
            Failed to create request. It may overlap with an existing one.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Request detail page (URL: /availability/requests/:requestId) ──

export function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const detailQuery = useQuery({
    queryKey: ["availability", "request", requestId],
    queryFn: () =>
      api.get<RequestDetail>(`/availability/requests/${requestId}`),
    enabled: !!requestId,
  });

  if (detailQuery.isPending)
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  if (detailQuery.isError)
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-red-600">Failed to load request.</p>
      </div>
    );

  const data = detailQuery.data;
  if (!data) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate("/availability")}
          >
            Back
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {format(new Date(data.start_date), "d MMM")} —{" "}
              {format(new Date(data.end_date), "d MMM yyyy")}
            </h2>
            <p className="text-sm text-gray-500">
              {data.dates.length} game date
              {data.dates.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {data.dates.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-gray-400">
                No game dates in this request window.
              </p>
            </CardContent>
          </Card>
        )}

        {data.dates.map((date) => (
          <Card
            key={date.matchDate}
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() =>
              void navigate(
                `/availability/requests/${requestId}/dates/${date.matchDate}`,
              )
            }
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {format(new Date(date.matchDate), "EEEE d MMMM yyyy")}
                </p>
                <div className="flex flex-wrap gap-1 text-sm">
                  {date.fixtures.map((f) => (
                    <Badge
                      key={f.matchId}
                      variant="outline"
                      className="text-xs"
                    >
                      {f.teamName} vs {f.opposition}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 flex gap-2 text-sm">
                  {date.totalResponses > 0 ? (
                    <>
                      <span className="text-green-600">
                        {date.available} available
                      </span>
                      {date.maybe > 0 && (
                        <span className="text-yellow-600">
                          {date.maybe} maybe
                        </span>
                      )}
                      {date.unavailable > 0 && (
                        <span className="text-red-600">
                          {date.unavailable} unavailable
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">No responses yet</span>
                  )}
                  {date.assignments > 0 && (
                    <span className="text-blue-600">
                      {date.assignments} assigned
                    </span>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline">
                Select Teams
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Date grid page (URL: /availability/requests/:requestId/dates/:matchDate) ──
// Team selection UI: available players on the left, fixture team slots on the right

export function DateGridPage() {
  const { requestId, matchDate } = useParams<{
    requestId: string;
    matchDate: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const gridQuery = useQuery({
    queryKey: ["availability", "grid", requestId, matchDate],
    queryFn: () =>
      api.get<GridData>(
        `/availability/requests/${requestId}/grid?matchDate=${matchDate}`,
      ),
    enabled: !!requestId && !!matchDate,
  });

  const setStatusMutation = useMutation({
    mutationFn: (input: { dateId: string; memberId: string; status: string }) =>
      api.post(`/availability/dates/${input.dateId}/set`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", requestId, matchDate],
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: (input: {
      dateId: string;
      matchdayId: string;
      memberId: string;
    }) =>
      api.post(`/availability/dates/${input.dateId}/assign`, {
        matchdayId: input.matchdayId,
        memberId: input.memberId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", requestId, matchDate],
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (input: {
      dateId: string;
      matchdayId: string;
      memberId: string;
    }) =>
      api.delete(`/availability/dates/${input.dateId}/assignments`, {
        matchdayId: input.matchdayId,
        memberId: input.memberId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", requestId, matchDate],
      });
    },
  });

  if (gridQuery.isPending)
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  if (gridQuery.isError)
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-red-600">Failed to load.</p>
      </div>
    );

  const data = gridQuery.data;
  if (!data) return null;

  const primaryDateId = data.availabilityDateIds[0];

  // Split players by status
  const availablePlayers = data.grid.filter(
    (r) => r.availabilityStatus === "available",
  );
  const maybePlayers = data.grid.filter(
    (r) => r.availabilityStatus === "maybe",
  );
  const unavailablePlayers = data.grid.filter(
    (r) => r.availabilityStatus === "unavailable",
  );
  const noResponsePlayers = data.grid.filter(
    (r) => r.availabilityStatus === null,
  );

  // Build assigned member sets per matchday
  const assignedByMatchday = new Map<string, Set<string>>();
  const assignedMembers = new Set<string>();
  for (const row of data.grid) {
    for (const a of row.assignments) {
      assignedMembers.add(row.memberId);
      const set = assignedByMatchday.get(a.matchdayId) ?? new Set();
      set.add(row.memberId);
      assignedByMatchday.set(a.matchdayId, set);
    }
  }

  // Grid row lookup
  const rowByMemberId = new Map(data.grid.map((r) => [r.memberId, r]));

  const handleAssign = (matchdayId: string, memberId: string) => {
    assignMutation.mutate({
      dateId: primaryDateId,
      matchdayId,
      memberId,
    });
  };

  const handleUnassign = (matchdayId: string, memberId: string) => {
    unassignMutation.mutate({
      dateId: primaryDateId,
      matchdayId,
      memberId,
    });
  };

  const handleSetStatus = (memberId: string, status: string) => {
    setStatusMutation.mutate({
      dateId: primaryDateId,
      memberId,
      status,
    });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate(`/availability/requests/${requestId}`)}
          >
            Back
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {matchDate && format(new Date(matchDate), "EEEE d MMMM yyyy")}
            </h2>
            <div className="flex gap-3 text-sm">
              <span className="text-green-600">
                {availablePlayers.length} available
              </span>
              <span className="text-yellow-600">
                {maybePlayers.length} maybe
              </span>
              <span className="text-red-600">
                {unavailablePlayers.length} unavailable
              </span>
              <span className="text-gray-400">
                {noResponsePlayers.length} no response
              </span>
            </div>
          </div>
        </div>

        {/* Main layout: team slots + available players */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Team slots — each fixture gets a card */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            {data.matchdays.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-gray-400">
                    No matchday records for this date yet. Create them from the
                    Official Panel to enable team selection.
                  </p>
                </CardContent>
              </Card>
            )}

            {data.matchdays.map((md) => {
              const assigned = assignedByMatchday.get(md.id) ?? new Set();
              const assignedRows = [...assigned]
                .map((id) => rowByMemberId.get(id))
                .filter((r): r is GridRow => r !== undefined);

              return (
                <Card key={md.id}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {md.team_name} vs {md.opposition}
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        ({assigned.size} selected)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {assignedRows.length === 0 ? (
                      <p className="text-sm text-gray-400">
                        No players assigned yet. Click a player from the
                        available list to add them.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {assignedRows.map((row, idx) => (
                          <div
                            key={row.memberId}
                            className="flex items-center justify-between rounded border border-gray-200 px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-6 text-center text-sm font-medium text-gray-400">
                                {idx + 1}
                              </span>
                              <div>
                                <p className="text-sm font-medium">
                                  {row.memberName ?? "Unknown"}
                                </p>
                                {row.memberCategory && (
                                  <p className="text-xs text-gray-400 capitalize">
                                    {row.memberCategory}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-800"
                              disabled={unassignMutation.isPending}
                              onClick={() =>
                                handleUnassign(md.id, row.memberId)
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Available players sidebar */}
          <div className="flex flex-col gap-4">
            <PlayerPool
              title="Available"
              players={availablePlayers}
              color="green"
              matchdays={data.matchdays}
              assignedMembers={assignedMembers}
              onAssign={handleAssign}
              onSetStatus={handleSetStatus}
            />
            <PlayerPool
              title="Maybe"
              players={maybePlayers}
              color="yellow"
              matchdays={data.matchdays}
              assignedMembers={assignedMembers}
              onAssign={handleAssign}
              onSetStatus={handleSetStatus}
            />
            {unavailablePlayers.length > 0 && (
              <PlayerPool
                title="Unavailable"
                players={unavailablePlayers}
                color="red"
                matchdays={data.matchdays}
                assignedMembers={assignedMembers}
                onAssign={handleAssign}
                onSetStatus={handleSetStatus}
              />
            )}
            {noResponsePlayers.length > 0 && (
              <PlayerPool
                title="No Response"
                players={noResponsePlayers}
                color="gray"
                matchdays={data.matchdays}
                assignedMembers={assignedMembers}
                onAssign={handleAssign}
                onSetStatus={handleSetStatus}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerPool({
  title,
  players,
  color,
  matchdays,
  assignedMembers,
  onAssign,
  onSetStatus,
}: {
  title: string;
  players: GridRow[];
  color: "green" | "yellow" | "red" | "gray";
  matchdays: GridData["matchdays"];
  assignedMembers: Set<string>;
  onAssign: (matchdayId: string, memberId: string) => void;
  onSetStatus: (memberId: string, status: string) => void;
}) {
  const colorMap = {
    green: "border-green-200 bg-green-50",
    yellow: "border-yellow-200 bg-yellow-50",
    red: "border-red-200 bg-red-50",
    gray: "border-gray-200 bg-gray-50",
  };

  const headerColor = {
    green: "text-green-800",
    yellow: "text-yellow-800",
    red: "text-red-800",
    gray: "text-gray-600",
  };

  return (
    <Card className={colorMap[color]}>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm ${headerColor[color]}`}>
          {title} ({players.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <div className="flex flex-col gap-1">
            {players.map((row) => {
              const isAssigned = assignedMembers.has(row.memberId);
              return (
                <div
                  key={row.memberId}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                    isAssigned ? "bg-blue-50 text-blue-700" : "bg-white"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {row.memberName ?? "Unknown"}
                      {isAssigned && (
                        <span className="ml-1 text-xs text-blue-500">
                          (assigned)
                        </span>
                      )}
                    </p>
                    {row.availabilityNotes && (
                      <p className="truncate text-xs text-gray-400">
                        {row.availabilityNotes}
                      </p>
                    )}
                  </div>
                  <div className="ml-2 flex items-center gap-1">
                    {/* Quick assign to a fixture */}
                    {matchdays.length > 0 && !isAssigned && (
                      <Select
                        onValueChange={(matchdayId) =>
                          onAssign(matchdayId, row.memberId)
                        }
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue placeholder="Add to" />
                        </SelectTrigger>
                        <SelectContent>
                          {matchdays.map((md) => (
                            <SelectItem key={md.id} value={md.id}>
                              {md.team_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {/* Override status */}
                    {color === "gray" && (
                      <Select
                        onValueChange={(status) =>
                          onSetStatus(row.memberId, status)
                        }
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue placeholder="Set" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="available">Avail</SelectItem>
                          <SelectItem value="maybe">Maybe</SelectItem>
                          <SelectItem value="unavailable">Unavail</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
