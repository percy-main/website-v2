import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router";

// ── Types ──

interface AvailabilityFixture {
  id: string;
  availability_request_id: string;
  match_date: string;
  opposition: string;
  is_home: boolean;
  competition_name: string | null;
  match_time: string | null;
  team_name: string | null;
}

interface MyResponse {
  id: string;
  availability_request_id: string;
  match_date: string;
  status: string;
  note: string | null;
}

interface ActiveRequest {
  id: string;
  date_from: string;
  date_to: string;
  status: string;
  fixtures: AvailabilityFixture[];
  myResponses: MyResponse[];
}

interface ActiveRequestsResponse {
  memberId: string | null;
  items: ActiveRequest[];
}

// ── Component ──

export function Component() {
  const query = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => api.get<ActiveRequestsResponse>("/availability/active"),
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between">
        <h1>Availability</h1>
        <Link
          className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
          to="/members"
        >
          Members Area
        </Link>
      </div>

      {query.isPending && <p className="mt-4 text-gray-500">Loading...</p>}
      {query.isError && (
        <p className="mt-4 text-red-600">Failed to load availability.</p>
      )}

      {query.data && !query.data.memberId && (
        <Card className="mt-4">
          <CardContent className="py-6 text-center text-gray-500">
            You need to complete your membership registration before you can
            respond to availability requests.
          </CardContent>
        </Card>
      )}

      {query.data?.items.length === 0 && query.data?.memberId && (
        <Card className="mt-4">
          <CardContent className="py-6 text-center text-gray-500">
            No active availability requests right now. Check back later.
          </CardContent>
        </Card>
      )}

      {query.data?.memberId &&
        query.data.items.map((req) => (
          <RequestCard key={req.id} request={req} />
        ))}
    </div>
  );
}

// ── Request Card ──

function RequestCard({ request }: { request: ActiveRequest }) {
  // Group fixtures by date
  const fixturesByDate = new Map<string, AvailabilityFixture[]>();
  for (const f of request.fixtures) {
    const list = fixturesByDate.get(f.match_date) ?? [];
    list.push(f);
    fixturesByDate.set(f.match_date, list);
  }

  // Build existing responses map
  const existingByDate = new Map<string, MyResponse>();
  for (const r of request.myResponses) {
    existingByDate.set(r.match_date, r);
  }

  const dates = Array.from(fixturesByDate.keys()).sort();

  return (
    <div className="mt-4 flex flex-col gap-4">
      {dates.map((date) => (
        <DateCard
          key={date}
          requestId={request.id}
          date={date}
          fixtures={fixturesByDate.get(date) ?? []}
          existing={existingByDate.get(date)}
        />
      ))}
    </div>
  );
}

function DateCard({
  requestId,
  date,
  fixtures,
  existing,
}: {
  requestId: string;
  date: string;
  fixtures: AvailabilityFixture[];
  existing: MyResponse | undefined;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(existing?.status ?? "");
  const [note, setNote] = useState(existing?.note ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/availability/requests/${requestId}/respond`, {
        responses: [
          {
            matchDate: date,
            status: status as "available" | "unavailable",
            note: note || undefined,
          },
        ],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["availability", "active"],
      });
    },
  });

  const hasChanged =
    (status === "available" || status === "unavailable") &&
    (status !== (existing?.status ?? "") || note !== (existing?.note ?? ""));

  return (
    <div className="rounded border p-3">
      <p className="mb-2 text-sm font-semibold">
        {format(new Date(date), "EEEE d MMMM")}
      </p>
      <div className="mb-3 flex flex-col gap-1">
        {fixtures.map((f) => (
          <p key={f.id} className="text-sm text-gray-600">
            {f.team_name ?? "Team"} {f.is_home ? "vs" : "@"} {f.opposition}
            {f.competition_name && (
              <span className="text-gray-400"> ({f.competition_name})</span>
            )}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`rounded px-3 py-1 text-sm ${
            status === "available"
              ? "bg-green-600 text-white"
              : "border bg-white text-gray-700 hover:bg-green-50"
          }`}
          onClick={() => setStatus("available")}
        >
          Available
        </button>
        <button
          className={`rounded px-3 py-1 text-sm ${
            status === "unavailable"
              ? "bg-red-600 text-white"
              : "border bg-white text-gray-700 hover:bg-red-50"
          }`}
          onClick={() => setStatus("unavailable")}
        >
          Unavailable
        </button>
      </div>

      {status && (
        <Textarea
          className="mt-2"
          placeholder="Optional note (e.g. free after 1pm)"
          rows={1}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      <Button
        className="mt-3"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !status || !hasChanged}
        size="sm"
      >
        {mutation.isPending
          ? "Saving..."
          : existing
            ? "Update Response"
            : "Submit Response"}
      </Button>

      {mutation.isSuccess && (
        <p className="mt-1 text-sm text-green-600">Saved.</p>
      )}
      {mutation.isError && (
        <p className="mt-1 text-sm text-red-600">Failed to save.</p>
      )}
    </div>
  );
}
