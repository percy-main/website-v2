import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen.js";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { IoLockClosed } from "react-icons/io5";
import { Link, useParams } from "react-router";

// ── Types ──

type PublicData =
  paths["/api/availability/requests/{requestId}/public"]["get"]["responses"][200]["content"]["application/json"];
type Fixture = PublicData["fixtures"][number];

interface DraftResponse {
  matchDate: string;
  status: "available" | "unavailable";
  note?: string;
}

function getDraftKey(requestId: string) {
  return `availability-draft-${requestId}`;
}

function loadDraft(requestId: string): DraftResponse[] | null {
  try {
    const raw = localStorage.getItem(getDraftKey(requestId));
    if (!raw) return null;
    return JSON.parse(raw) as DraftResponse[];
  } catch {
    return null;
  }
}

function clearDraft(requestId: string) {
  localStorage.removeItem(getDraftKey(requestId));
}

// ── Component ──

export function Component() {
  useDocumentMeta("Availability");
  const { requestId } = useParams<{ requestId: string }>();
  const { data: session, isPending: sessionPending } = useSession();

  const query = useQuery({
    queryKey: ["availability", "public", requestId],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests/{requestId}/public", {
          params: { path: { requestId: requestId ?? "" } },
        }),
      ),
    enabled: !!requestId,
  });

  // Check for existing member record (only if signed in)
  const memberQuery = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
    enabled: !!session,
  });

  const hasMemberRecord = memberQuery.data?.memberId != null;
  const isSignedIn = !!session;

  // Load draft from localStorage (once, on mount — for users returning after sign-up)
  const initialResponses = useMemo(() => {
    if (!requestId || !isSignedIn) return new Map<string, DraftResponse>();
    const draft = loadDraft(requestId);
    if (!draft) return new Map<string, DraftResponse>();
    const map = new Map<string, DraftResponse>();
    for (const r of draft) {
      map.set(r.matchDate, r);
    }
    return map;
  }, [requestId, isSignedIn]);

  const [responses, setResponses] =
    useState<Map<string, DraftResponse>>(initialResponses);
  const [submitted, setSubmitted] = useState(false);

  // Populate from server responses if signed in and no draft exists
  const serverResponses = useMemo(() => {
    if (!memberQuery.data || !requestId) return null;
    if (initialResponses.size > 0) return null;
    const activeRequest = memberQuery.data.items.find(
      (r) => r.id === requestId,
    );
    if (!activeRequest?.myResponses.length) return null;
    const map = new Map<string, DraftResponse>();
    for (const r of activeRequest.myResponses) {
      map.set(r.match_date, {
        matchDate: r.match_date,
        status: r.status as "available" | "unavailable",
        note: r.note ?? undefined,
      });
    }
    return map;
  }, [memberQuery.data, requestId, initialResponses.size]);

  // Use server responses if we haven't interacted yet
  const effectiveResponses =
    responses.size > 0 ? responses : (serverResponses ?? responses);

  const setDateResponse = useCallback(
    (matchDate: string, status: "available" | "unavailable") => {
      setResponses((prev) => {
        // Merge with server responses if user hasn't interacted yet
        const base = prev.size > 0 ? prev : (serverResponses ?? prev);
        const next = new Map(base);
        const existing = next.get(matchDate);
        next.set(matchDate, {
          matchDate,
          status,
          note: existing?.note,
        });
        return next;
      });
    },
    [serverResponses],
  );

  const setDateNote = useCallback(
    (matchDate: string, note: string) => {
      setResponses((prev) => {
        const base = prev.size > 0 ? prev : (serverResponses ?? prev);
        const next = new Map(base);
        const existing = next.get(matchDate);
        if (existing) {
          next.set(matchDate, { ...existing, note });
        }
        return next;
      });
    },
    [serverResponses],
  );

  const queryClient = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/respond", {
          params: { path: { requestId: requestId ?? "" } },
          body: {
            responses: Array.from(effectiveResponses.values()).map((r) => ({
              matchDate: r.matchDate,
              status: r.status,
              note: r.note ?? undefined,
            })),
          },
        }),
      ),
    onSuccess: () => {
      if (requestId) clearDraft(requestId);
      setSubmitted(true);
      void queryClient.invalidateQueries({
        queryKey: ["availability"],
      });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!requestId) return;
    submitMutation.mutate();
  }, [requestId, submitMutation]);

  if (query.isPending || sessionPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1>Availability</h1>
        <p className="mt-4 text-center text-stone-500">
          This availability request could not be found or is no longer open.
        </p>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  // Group fixtures by date
  const fixturesByDate = new Map<string, Fixture[]>();
  for (const f of data.fixtures) {
    const list = fixturesByDate.get(f.match_date) ?? [];
    list.push(f);
    fixturesByDate.set(f.match_date, list);
  }
  const dates = Array.from(fixturesByDate.keys()).sort();

  const hasDraft =
    requestId && isSignedIn ? loadDraft(requestId) !== null : false;
  const hasResponses = effectiveResponses.size > 0;

  const returnTo = encodeURIComponent(`/availability/${requestId}`);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Availability</h1>

      {hasDraft && isSignedIn && (
        <Alert className="mt-4">
          <AlertDescription>
            You have unsaved responses from before you signed up. Review them
            below and submit when ready.
          </AlertDescription>
        </Alert>
      )}

      {isSignedIn && !hasMemberRecord && !memberQuery.isPending && (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>
            You need to complete your membership registration before you can
            submit availability responses.{" "}
            <Link to="/members" className="font-medium underline">
              Go to Members Area
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {submitted && (
        <Alert className="mt-4">
          <AlertDescription>
            Your availability has been saved. You can update your responses at
            any time from the{" "}
            <Link to="/members/availability" className="font-medium underline">
              Members Area
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {!isSignedIn && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <IoLockClosed className="size-4 shrink-0" />
          <p>
            <Link
              to={`/auth/login?returnTo=${returnTo}`}
              className="font-medium underline"
            >
              Sign in
            </Link>{" "}
            or{" "}
            <Link
              to={`/auth/register?returnTo=${returnTo}`}
              className="font-medium underline"
            >
              create an account
            </Link>{" "}
            to submit your availability.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {dates.map((date) => (
          <DateCard
            key={date}
            date={date}
            fixtures={fixturesByDate.get(date) ?? []}
            response={effectiveResponses.get(date)}
            onStatusChange={(status) => setDateResponse(date, status)}
            onNoteChange={(note) => setDateNote(date, note)}
            disabled={submitted || !isSignedIn}
            locked={!isSignedIn}
          />
        ))}
      </div>

      {!submitted && dates.length > 0 && isSignedIn && (
        <div className="mt-6">
          <Button
            onClick={handleSubmit}
            disabled={
              !hasResponses || submitMutation.isPending || !hasMemberRecord
            }
            className="w-full sm:w-auto"
          >
            {submitMutation.isPending ? "Saving…" : "Submit Responses"}
          </Button>
          {submitMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              Failed to save your responses. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Date Card ──

function DateCard({
  date,
  fixtures,
  response,
  onStatusChange,
  onNoteChange,
  disabled,
  locked,
}: {
  date: string;
  fixtures: Fixture[];
  response: DraftResponse | undefined;
  onStatusChange: (status: "available" | "unavailable") => void;
  onNoteChange: (note: string) => void;
  disabled: boolean;
  locked: boolean;
}) {
  return (
    <div className={`rounded border p-3 ${locked ? "opacity-60" : ""}`}>
      <p className="mb-2 text-sm font-semibold">
        {format(new Date(date), "EEEE d MMMM")}
      </p>
      <div className="mb-3 flex flex-col gap-1">
        {fixtures.map((f) => (
          <p key={f.id} className="text-sm text-stone-600">
            {f.team_name ?? "Team"} {f.is_home ? "vs" : "@"} {f.opposition}
            {f.competition_name && (
              <span className="text-stone-400"> ({f.competition_name})</span>
            )}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`rounded px-3 py-1 text-sm ${
            response?.status === "available"
              ? "bg-green-600 text-white"
              : "border bg-white text-stone-700"
          } ${locked ? "cursor-not-allowed" : "hover:bg-green-50"}`}
          onClick={() => onStatusChange("available")}
          disabled={disabled}
        >
          Available
        </button>
        <button
          className={`rounded px-3 py-1 text-sm ${
            response?.status === "unavailable"
              ? "bg-red-600 text-white"
              : "border bg-white text-stone-700"
          } ${locked ? "cursor-not-allowed" : "hover:bg-red-50"}`}
          onClick={() => onStatusChange("unavailable")}
          disabled={disabled}
        >
          Unavailable
        </button>
      </div>

      {response?.status && (
        <Textarea
          className="mt-2"
          placeholder="Optional note (e.g. free after 1pm)"
          rows={1}
          value={response.note ?? ""}
          onChange={(e) => onNoteChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
