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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router";

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

interface PlayCricketFixture {
  matchId: string;
  matchDate: string;
  opposition: string;
  teamId: string;
  teamName: string;
  isHome: boolean;
  competitionType: string | null;
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

// ── Component ──

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

        {isOfficial ? <OfficialAvailability /> : <MemberAvailability />}
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
    myAssignments: Array<{
      matchday_id: string;
      opposition: string | null;
    }>;
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

// ── Official view ──

function OfficialAvailability() {
  const [view, setView] = useState<
    | { type: "list" }
    | { type: "create" }
    | { type: "request"; requestId: string }
    | { type: "grid"; requestId: string; matchDate: string }
  >({ type: "list" });

  if (view.type === "create") {
    return (
      <CreateRequestView
        onBack={() => setView({ type: "list" })}
        onCreated={(id) => setView({ type: "request", requestId: id })}
      />
    );
  }

  if (view.type === "request") {
    return (
      <RequestDetailView
        requestId={view.requestId}
        onBack={() => setView({ type: "list" })}
        onSelectDate={(matchDate) =>
          setView({
            type: "grid",
            requestId: view.requestId,
            matchDate,
          })
        }
      />
    );
  }

  if (view.type === "grid") {
    return (
      <DateGridView
        requestId={view.requestId}
        matchDate={view.matchDate}
        onBack={() => setView({ type: "request", requestId: view.requestId })}
      />
    );
  }

  return (
    <RequestListView
      onCreateNew={() => setView({ type: "create" })}
      onSelectRequest={(id) => setView({ type: "request", requestId: id })}
    />
  );
}

// ── Request list ──

function RequestListView({
  onCreateNew,
  onSelectRequest,
}: {
  onCreateNew: () => void;
  onSelectRequest: (id: string) => void;
}) {
  const queryClient = useQueryClient();

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
        <Button onClick={onCreateNew}>New Request</Button>
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
          onClick={() => onSelectRequest(req.id)}
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
                {req.gameDates.length !== 1 ? "s" : ""}, {req.matchdays.length}{" "}
                fixture
                {req.matchdays.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
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
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Create request ──

function CreateRequestView({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
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
      if (data?.id) onCreated(data.id);
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
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

      {/* Overlap warning */}
      {preview?.overlapping && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-red-800">
              This date range overlaps with an existing availability request.
              Adjust the dates to avoid overlap.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Preview games */}
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
                No games found in this date range. Availability dates will be
                created when matchdays are added.
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

      {/* Confirm */}
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
  );
}

// ── Request detail (dates list) ──

function RequestDetailView({
  requestId,
  onBack,
  onSelectDate,
}: {
  requestId: string;
  onBack: () => void;
  onSelectDate: (matchDate: string) => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["availability", "request", requestId],
    queryFn: () =>
      api.get<RequestDetail>(`/availability/requests/${requestId}`),
  });

  if (detailQuery.isPending) return <p className="text-gray-500">Loading...</p>;
  if (detailQuery.isError)
    return <p className="text-red-600">Failed to load request.</p>;

  const data = detailQuery.data;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
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
              No game dates in this request window yet.
            </p>
          </CardContent>
        </Card>
      )}

      {data.dates.map((date) => (
        <Card
          key={date.matchDate}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => onSelectDate(date.matchDate)}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                {format(new Date(date.matchDate), "EEEE d MMMM yyyy")}
              </p>
              <div className="flex flex-wrap gap-1 text-sm">
                {date.fixtures.map((f) => (
                  <Badge key={f.matchId} variant="outline" className="text-xs">
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
  );
}

// ── Date grid (team selection) ──

function DateGridView({
  requestId,
  matchDate,
  onBack,
}: {
  requestId: string;
  matchDate: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const gridQuery = useQuery({
    queryKey: ["availability", "grid", requestId, matchDate],
    queryFn: () =>
      api.get<GridData>(
        `/availability/requests/${requestId}/grid?matchDate=${matchDate}`,
      ),
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
    return <p className="text-gray-500">Loading grid...</p>;
  if (gridQuery.isError)
    return <p className="text-red-600">Failed to load grid.</p>;

  const data = gridQuery.data;
  if (!data) return null;

  // Use the first availability_date_id for set/assign/unassign operations
  const primaryDateId = data.availabilityDateIds[0];

  const filteredGrid =
    statusFilter === "all"
      ? data.grid
      : statusFilter === "no_response"
        ? data.grid.filter((r) => r.availabilityStatus === null)
        : data.grid.filter((r) => r.availabilityStatus === statusFilter);

  const availableCount = data.grid.filter(
    (r) => r.availabilityStatus === "available",
  ).length;
  const maybeCount = data.grid.filter(
    (r) => r.availabilityStatus === "maybe",
  ).length;
  const unavailableCount = data.grid.filter(
    (r) => r.availabilityStatus === "unavailable",
  ).length;
  const noResponseCount = data.grid.filter(
    (r) => r.availabilityStatus === null,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold">
            {format(new Date(data.matchDate), "EEEE d MMMM yyyy")}
          </h2>
          <div className="flex gap-3 text-sm">
            <span className="text-green-600">{availableCount} available</span>
            <span className="text-yellow-600">{maybeCount} maybe</span>
            <span className="text-red-600">{unavailableCount} unavailable</span>
            <span className="text-gray-400">{noResponseCount} no response</span>
          </div>
        </div>
      </div>

      {/* Fixtures on this date */}
      {data.matchdays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fixtures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.matchdays.map((md) => (
                <Badge key={md.id} variant="outline">
                  {md.team_name} vs {md.opposition}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Filter:</label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({data.grid.length})</SelectItem>
            <SelectItem value="available">
              Available ({availableCount})
            </SelectItem>
            <SelectItem value="maybe">Maybe ({maybeCount})</SelectItem>
            <SelectItem value="unavailable">
              Unavailable ({unavailableCount})
            </SelectItem>
            <SelectItem value="no_response">
              No response ({noResponseCount})
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                {data.matchdays.length > 0 && <TableHead>Assigned</TableHead>}
                <TableHead className="text-right">Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGrid.map((row) => (
                <GridRowView
                  key={row.memberId}
                  row={row}
                  matchdays={data.matchdays}
                  primaryDateId={primaryDateId}
                  setStatusMutation={setStatusMutation}
                  assignMutation={assignMutation}
                  unassignMutation={unassignMutation}
                />
              ))}
              {filteredGrid.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={data.matchdays.length > 0 ? 5 : 4}
                    className="py-8 text-center text-gray-400"
                  >
                    No players match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function GridRowView({
  row,
  matchdays,
  primaryDateId,
  setStatusMutation,
  assignMutation,
  unassignMutation,
}: {
  row: GridRow;
  matchdays: GridData["matchdays"];
  primaryDateId: string;
  setStatusMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { dateId: string; memberId: string; status: string }
    >
  >;
  assignMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { dateId: string; matchdayId: string; memberId: string }
    >
  >;
  unassignMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { dateId: string; matchdayId: string; memberId: string }
    >
  >;
}) {
  const assignedMatchdayIds = new Set(row.assignments.map((a) => a.matchdayId));

  return (
    <TableRow>
      <TableCell>
        <div>
          <p className="font-medium">{row.memberName ?? "Unknown"}</p>
          {row.memberCategory && (
            <p className="text-xs text-gray-400 capitalize">
              {row.memberCategory}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        {row.availabilityStatus ? (
          <Badge
            className={STATUS_COLORS[row.availabilityStatus] ?? ""}
            variant="outline"
          >
            {STATUS_LABELS[row.availabilityStatus] ?? row.availabilityStatus}
          </Badge>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm text-gray-500">
          {row.availabilityNotes ?? "—"}
        </span>
      </TableCell>
      {matchdays.length > 0 && (
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {matchdays.map((md) => {
              const isAssigned = assignedMatchdayIds.has(md.id);
              return (
                <button
                  key={md.id}
                  type="button"
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    isAssigned
                      ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                  }`}
                  disabled={
                    assignMutation.isPending || unassignMutation.isPending
                  }
                  onClick={() => {
                    if (isAssigned) {
                      unassignMutation.mutate({
                        dateId: primaryDateId,
                        matchdayId: md.id,
                        memberId: row.memberId,
                      });
                    } else {
                      assignMutation.mutate({
                        dateId: primaryDateId,
                        matchdayId: md.id,
                        memberId: row.memberId,
                      });
                    }
                  }}
                >
                  {md.team_name ? `${md.team_name} vs ` : ""}
                  {md.opposition}
                  {isAssigned ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        </TableCell>
      )}
      <TableCell className="text-right">
        <Select
          value={row.availabilityStatus ?? ""}
          onValueChange={(status) =>
            setStatusMutation.mutate({
              dateId: primaryDateId,
              memberId: row.memberId,
              status,
            })
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Set status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="maybe">Maybe</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
