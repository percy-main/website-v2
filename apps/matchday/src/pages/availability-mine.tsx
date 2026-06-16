import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

/**
 * Review/edit your availability. Lists every open request and every date
 * (answered or not) with the current vote and an inline change affordance.
 * The step-by-step wizard at /availability/respond stays for fast-path
 * first-time answering; this page is the persistent surface a player
 * lands on when they want to remember or change what they said.
 *
 * A parent of juniors sees a section per subject - themselves plus each
 * dependent (a junior playing up into a senior squad) - since the wizard
 * only walks unanswered dates, this is where a parent goes back to change
 * a dependent's answer.
 */

type ActiveResponse = ApiResponse<"/api/availability/active">;
type ActiveItem = ActiveResponse["items"][number];
type Fixture = ActiveItem["fixtures"][number];
type AvailableCount = ActiveItem["availableCounts"][number];
type Dependent = ActiveResponse["dependents"][number];

const SELF_KEY = "self";

interface SubjectRow {
  key: string;
  name: string;
  dependentId: string | null;
}

// An existing answer for a (subject, date): note + status, shared shape
// across self and dependents.
interface ExistingAnswer {
  status: string;
  note: string | null;
}

export default function AvailabilityMine() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-6">
        <div className="bg-border h-6 w-1/3 rounded-md" />
        <div className="bg-border h-32 rounded-2xl" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mx-auto max-w-md px-6 py-12 text-center">
        <h1 className="text-lg font-semibold">Couldn't load availability</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Try again in a moment.
        </p>
        <Button asChild tone="outline" className="mt-4 inline-flex">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  const items = (data?.items ?? []).filter((i) => i.status === "open");
  const dependents = data?.dependents ?? [];
  const subjects = buildSubjects(dependents);
  const unansweredCount = countUnanswered(items, subjects);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-[-0.015em]">
          Your availability
        </h1>
        {unansweredCount > 0 && (
          <Button asChild tone="primary" size="sm">
            <Link to="/availability/respond">
              Answer {unansweredCount}
              <ArrowRightIcon className="size-4" />
            </Link>
          </Button>
        )}
      </header>

      {items.length === 0 && (
        <Card>
          <CardContent className="text-text-secondary py-8 text-center text-sm">
            No open availability requests right now. We'll let you know.
          </CardContent>
        </Card>
      )}

      {items.map((req) => (
        <RequestCard key={req.id} request={req} subjects={subjects} />
      ))}
    </div>
  );
}

function buildSubjects(dependents: Dependent[]): SubjectRow[] {
  return [
    { key: SELF_KEY, name: "You", dependentId: null },
    ...dependents.map((d) => ({ key: d.id, name: d.name, dependentId: d.id })),
  ];
}

function answeredDatesFor(item: ActiveItem, subject: SubjectRow): Set<string> {
  if (subject.dependentId === null) {
    return new Set(item.myResponses.map((r) => r.match_date));
  }
  return new Set(
    item.dependentResponses
      .filter((r) => r.dependent_id === subject.dependentId)
      .map((r) => r.match_date),
  );
}

function existingFor(
  item: ActiveItem,
  subject: SubjectRow,
  date: string,
): ExistingAnswer | undefined {
  if (subject.dependentId === null) {
    return item.myResponses.find((r) => r.match_date === date);
  }
  return item.dependentResponses.find(
    (r) => r.dependent_id === subject.dependentId && r.match_date === date,
  );
}

function countUnanswered(items: ActiveItem[], subjects: SubjectRow[]): number {
  let n = 0;
  for (const item of items) {
    const dates = new Set(item.fixtures.map((f) => f.match_date));
    for (const subject of subjects) {
      const answered = answeredDatesFor(item, subject);
      for (const d of dates) if (!answered.has(d)) n++;
    }
  }
  return n;
}

function RequestCard({
  request,
  subjects,
}: {
  request: ActiveItem;
  subjects: SubjectRow[];
}) {
  const byDate = new Map<string, Fixture[]>();
  for (const f of request.fixtures) {
    const list = byDate.get(f.match_date) ?? [];
    list.push(f);
    byDate.set(f.match_date, list);
  }
  const dates = Array.from(byDate.keys()).sort();
  const availableCountByDate = new Map<string, AvailableCount>();
  for (const c of request.availableCounts) {
    availableCountByDate.set(c.match_date, c);
  }

  const multiSubject = subjects.length > 1;

  return (
    <Card>
      <CardHeader>
        <CardEyebrow icon={CircleCheckIcon}>
          {fmtDate(request.date_from, "d MMM")}
          {request.date_from !== request.date_to &&
            ` - ${fmtDate(request.date_to, "d MMM")}`}
        </CardEyebrow>
        <CardTitle>
          {dates.length} {dates.length === 1 ? "date" : "dates"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {subjects.map((subject) => (
          <div key={subject.key} className="space-y-2">
            {multiSubject && (
              <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
                {subject.key === SELF_KEY ? "You" : subject.name}
              </p>
            )}
            {dates.map((date) => (
              <DateRow
                key={`${subject.key}:${date}`}
                requestId={request.id}
                date={date}
                fixtures={byDate.get(date) ?? []}
                subjectDependentId={subject.dependentId}
                existing={existingFor(request, subject, date)}
                availableCount={availableCountByDate.get(date)?.count ?? 0}
              />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DateRow({
  requestId,
  date,
  fixtures,
  subjectDependentId,
  existing,
  availableCount,
}: {
  requestId: string;
  date: string;
  fixtures: Fixture[];
  subjectDependentId: string | null;
  existing: ExistingAnswer | undefined;
  availableCount: number;
}) {
  const qc = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<
    "available" | "unavailable" | null
  >(null);

  const mutation = useMutation({
    mutationFn: (status: "available" | "unavailable") =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/respond", {
          params: { path: { requestId } },
          body: {
            ...(subjectDependentId ? { subjectDependentId } : {}),
            responses: [
              {
                matchDate: date,
                status,
                ...(existing?.note && { note: existing.note }),
              },
            ],
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
      setPendingStatus(null);
    },
    onError: () => {
      setPendingStatus(null);
    },
  });

  const current = existing?.status ?? null;

  function choose(next: "available" | "unavailable") {
    if (current === next || mutation.isPending) return;
    setPendingStatus(next);
    mutation.mutate(next);
  }

  return (
    <div className="border-border bg-surface rounded-xl border p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{fmtDate(date, "EEEE d MMMM")}</p>
        {current ? (
          <span
            className={cn(
              "text-[11px] font-semibold tracking-[0.06em] uppercase",
              current === "available" ? "text-success" : "text-danger",
            )}
          >
            {current === "available" ? "Available" : "Unavailable"}
          </span>
        ) : (
          <span className="text-warning text-[11px] font-semibold tracking-[0.06em] uppercase">
            Not answered
          </span>
        )}
      </div>
      <div className="text-text-secondary mt-1 space-y-0.5">
        {fixtures.map((f) => (
          <p key={f.id} className="text-xs">
            {[f.team_name, f.is_home ? "vs" : "@", f.opposition]
              .filter(Boolean)
              .join(" ")}
            {f.competition_name && (
              <span className="text-text-muted"> · {f.competition_name}</span>
            )}
            {f.match_time && (
              <span className="text-text-muted"> · {f.match_time}</span>
            )}
          </p>
        ))}
      </div>
      {existing?.note && (
        <p className="text-text-secondary mt-1 text-xs italic">
          "{existing.note}"
        </p>
      )}
      <p className="text-text-secondary mt-2 text-xs">
        {availableCount} {availableCount === 1 ? "player is" : "players are"}{" "}
        available so far
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => choose("available")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md border-2 px-3 py-2 text-sm font-semibold disabled:opacity-60",
            current === "available"
              ? "border-success/40 bg-success-bg text-success"
              : "border-border bg-surface text-text-secondary hover:bg-surface-raised",
          )}
          aria-pressed={current === "available"}
        >
          <CheckIcon className="size-4" strokeWidth={2.4} />
          {pendingStatus === "available" ? "Saving…" : "Available"}
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => choose("unavailable")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md border-2 px-3 py-2 text-sm font-semibold disabled:opacity-60",
            current === "unavailable"
              ? "border-danger/40 bg-danger-bg text-danger"
              : "border-border bg-surface text-text-secondary hover:bg-surface-raised",
          )}
          aria-pressed={current === "unavailable"}
        >
          <XIcon className="size-4" strokeWidth={2.4} />
          {pendingStatus === "unavailable" ? "Saving…" : "Unavailable"}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-danger mt-2 flex items-center gap-1.5 text-xs">
          <CircleAlertIcon className="size-3.5" />
          Couldn't save, try again.
        </p>
      )}
    </div>
  );
}
