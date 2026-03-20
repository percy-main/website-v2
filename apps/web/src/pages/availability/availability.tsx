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
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router";

// ── Types ──

interface Team {
  id: string;
  name: string;
  is_junior: boolean | null;
}

interface AvailabilityDate {
  id: string;
  play_cricket_team_id: string;
  match_date: string;
  created_at: string;
  declarations: Declaration[];
  assignments: Assignment[];
  matchdays: MatchdaySummary[];
}

interface Declaration {
  id: string;
  availability_date_id: string;
  member_id: string;
  status: string;
  notes: string | null;
  declared_at: string;
  member_name: string | null;
  member_email: string | null;
  member_category: string | null;
}

interface Assignment {
  id: string;
  availability_date_id: string;
  matchday_id: string;
  member_id: string;
  assigned_at: string;
  member_name: string | null;
  opposition: string | null;
  matchday_team_id: string | null;
}

interface MatchdaySummary {
  id: string;
  match_date: string;
  opposition: string;
  status: string;
}

interface GridData {
  date: {
    id: string;
    play_cricket_team_id: string;
    match_date: string;
  };
  matchdays: MatchdaySummary[];
  grid: GridRow[];
}

interface GridRow {
  memberId: string;
  memberName: string | null;
  memberEmail: string;
  memberCategory: string | null;
  availabilityStatus: string | null;
  availabilityNotes: string | null;
  declaredAt: string | null;
  assignments: Array<{
    assignmentId: string;
    matchdayId: string;
    opposition: string | null;
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
      {
        dateId: string;
        status: string;
        notes?: string;
      }
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
        {/* Show fixtures on this date */}
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

        {/* Show assignments */}
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

        {/* Notes toggle */}
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

        {/* Declare buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={date.myStatus === "available" ? "default" : "outline"}
            className={
              date.myStatus === "available"
                ? "bg-green-600 hover:bg-green-700"
                : ""
            }
            disabled={declareMutation.isPending}
            onClick={() => handleDeclare("available")}
          >
            Available
          </Button>
          <Button
            size="sm"
            variant={date.myStatus === "maybe" ? "default" : "outline"}
            className={
              date.myStatus === "maybe"
                ? "bg-yellow-500 hover:bg-yellow-600"
                : ""
            }
            disabled={declareMutation.isPending}
            onClick={() => handleDeclare("maybe")}
          >
            Maybe
          </Button>
          <Button
            size="sm"
            variant={date.myStatus === "unavailable" ? "default" : "outline"}
            className={
              date.myStatus === "unavailable"
                ? "bg-red-600 hover:bg-red-700"
                : ""
            }
            disabled={declareMutation.isPending}
            onClick={() => handleDeclare("unavailable")}
          >
            Unavailable
          </Button>
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
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["official", "myTeams"],
    queryFn: () => api.get<Team[]>("/matchday/teams"),
  });

  if (teamsQuery.isPending)
    return <p className="text-gray-500">Loading teams...</p>;
  if (teamsQuery.isError)
    return <p className="text-red-600">Failed to load teams.</p>;

  const teams = teamsQuery.data ?? [];

  if (teams.length === 0) {
    return (
      <p className="text-gray-500">
        No teams assigned. Contact an admin to be assigned as an official.
      </p>
    );
  }

  if (selectedDateId && selectedTeamId) {
    return (
      <AvailabilityGridView
        dateId={selectedDateId}
        teamId={selectedTeamId}
        onBack={() => setSelectedDateId(null)}
      />
    );
  }

  if (selectedTeamId) {
    return (
      <TeamAvailabilityView
        teamId={selectedTeamId}
        teamName={teams.find((t) => t.id === selectedTeamId)?.name ?? ""}
        onBack={() => setSelectedTeamId(null)}
        onSelectDate={(id) => setSelectedDateId(id)}
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
            <p className="text-sm text-gray-500">
              View and manage availability
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TeamAvailabilityView({
  teamId,
  teamName,
  onBack,
  onSelectDate,
}: {
  teamId: string;
  teamName: string;
  onBack: () => void;
  onSelectDate: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [newDate, setNewDate] = useState("");

  const datesQuery = useQuery({
    queryKey: ["availability", "dates", teamId],
    queryFn: () =>
      api.get<AvailabilityDate[]>(`/availability/dates?teamId=${teamId}`),
  });

  const createDateMutation = useMutation({
    mutationFn: (matchDate: string) =>
      api.post<{ id: string }>("/availability/dates", {
        teamId,
        matchDate,
      }),
    onSuccess: () => {
      setNewDate("");
      void queryClient.invalidateQueries({
        queryKey: ["availability", "dates", teamId],
      });
    },
  });

  const deleteDateMutation = useMutation({
    mutationFn: (dateId: string) => api.delete(`/availability/dates/${dateId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "dates", teamId],
      });
    },
  });

  const dates = datesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <h2 className="text-xl font-semibold">{teamName} — Availability</h2>
      </div>

      {/* Add new date */}
      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">
              Request availability for date
            </label>
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <Button
            disabled={!newDate || createDateMutation.isPending}
            onClick={() => createDateMutation.mutate(newDate)}
          >
            {createDateMutation.isPending ? "Creating..." : "Add Date"}
          </Button>
        </CardContent>
        {createDateMutation.isError && (
          <CardContent className="pt-0">
            <p className="text-sm text-red-600">
              Failed to create availability date. It may already exist.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Loading / error */}
      {datesQuery.isPending && (
        <p className="text-gray-500">Loading dates...</p>
      )}
      {datesQuery.isError && (
        <p className="text-red-600">Failed to load dates.</p>
      )}

      {/* Date list */}
      {dates.length === 0 && !datesQuery.isPending && (
        <p className="text-gray-500">
          No availability dates created yet. Add one above.
        </p>
      )}

      {dates.map((date) => {
        const available = date.declarations.filter(
          (d) => d.status === "available",
        ).length;
        const maybe = date.declarations.filter(
          (d) => d.status === "maybe",
        ).length;
        const unavailable = date.declarations.filter(
          (d) => d.status === "unavailable",
        ).length;
        const total = date.declarations.length;

        return (
          <Card key={date.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {format(new Date(date.match_date), "EEEE d MMMM yyyy")}
                </p>
                <div className="flex gap-2 text-sm">
                  {total > 0 ? (
                    <>
                      <span className="text-green-600">
                        {available} available
                      </span>
                      {maybe > 0 && (
                        <span className="text-yellow-600">{maybe} maybe</span>
                      )}
                      {unavailable > 0 && (
                        <span className="text-red-600">
                          {unavailable} unavailable
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">No responses yet</span>
                  )}
                </div>
                {date.matchdays.length > 0 && (
                  <p className="text-xs text-gray-400">
                    Fixtures:{" "}
                    {date.matchdays.map((m) => m.opposition).join(", ")}
                  </p>
                )}
                {date.assignments.length > 0 && (
                  <p className="text-xs text-gray-400">
                    {date.assignments.length} player
                    {date.assignments.length !== 1 ? "s" : ""} assigned
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onSelectDate(date.id)}>
                  View Grid
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-800"
                  disabled={deleteDateMutation.isPending}
                  onClick={() => deleteDateMutation.mutate(date.id)}
                >
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AvailabilityGridView({
  dateId,
  onBack,
}: {
  dateId: string;
  teamId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const gridQuery = useQuery({
    queryKey: ["availability", "grid", dateId],
    queryFn: () => api.get<GridData>(`/availability/dates/${dateId}/grid`),
  });

  const setStatusMutation = useMutation({
    mutationFn: (input: { memberId: string; status: string; notes?: string }) =>
      api.post(`/availability/dates/${dateId}/set`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", dateId],
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: (input: { matchdayId: string; memberId: string }) =>
      api.post(`/availability/dates/${dateId}/assign`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", dateId],
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (input: { matchdayId: string; memberId: string }) =>
      api.post(`/availability/dates/${dateId}/unassign`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "grid", dateId],
      });
    },
  });

  if (gridQuery.isPending)
    return <p className="text-gray-500">Loading grid...</p>;
  if (gridQuery.isError)
    return <p className="text-red-600">Failed to load grid.</p>;

  const data = gridQuery.data;
  if (!data) return null;

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
            {format(new Date(data.date.match_date), "EEEE d MMMM yyyy")}
          </h2>
          <div className="flex gap-3 text-sm">
            <span className="text-green-600">{availableCount} available</span>
            <span className="text-yellow-600">{maybeCount} maybe</span>
            <span className="text-red-600">{unavailableCount} unavailable</span>
            <span className="text-gray-400">{noResponseCount} no response</span>
          </div>
        </div>
      </div>

      {/* Matchdays on this date */}
      {data.matchdays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fixtures on this date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.matchdays.map((md) => (
                <Badge key={md.id} variant="outline">
                  vs {md.opposition}{" "}
                  <span className="ml-1 text-xs text-gray-400">
                    ({md.status})
                  </span>
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGrid.map((row) => (
                <GridRowView
                  key={row.memberId}
                  row={row}
                  matchdays={data.matchdays}
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
  setStatusMutation,
  assignMutation,
  unassignMutation,
}: {
  row: GridRow;
  matchdays: MatchdaySummary[];
  setStatusMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { memberId: string; status: string; notes?: string }
    >
  >;
  assignMutation: ReturnType<
    typeof useMutation<unknown, Error, { matchdayId: string; memberId: string }>
  >;
  unassignMutation: ReturnType<
    typeof useMutation<unknown, Error, { matchdayId: string; memberId: string }>
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
                        matchdayId: md.id,
                        memberId: row.memberId,
                      });
                    } else {
                      assignMutation.mutate({
                        matchdayId: md.id,
                        memberId: row.memberId,
                      });
                    }
                  }}
                >
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
