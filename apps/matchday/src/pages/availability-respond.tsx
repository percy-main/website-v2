import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

/**
 * Phase 2 availability response flow.
 *
 * Reads /api/availability/active. The response gives us each active
 * request + the list of fixtures in its date range + the user's
 * existing responses. We flatten across requests into the set of
 * (request, match_date) pairs the user hasn't answered yet, then walk
 * one date per screen.
 *
 * Per the plan: tap-not-swipe, both available/unavailable buttons on
 * the same screen, optional note, "apply same to all remaining"
 * power-user affordance, end-state celebration.
 */

type ActiveResponse = ApiResponse<"/api/availability/active">;
type ActiveItem = ActiveResponse["items"][number];
type Fixture = ActiveItem["fixtures"][number];

interface Step {
  requestId: string;
  date: string;
  fixtures: Fixture[];
}

export default function AvailabilityRespond() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });

  const computedSteps = useMemo<Step[]>(() => {
    if (!data) return [];
    const out: Step[] = [];
    for (const item of data.items) {
      if (item.status !== "open") continue;
      // The unique match_dates in this request, grouped from the
      // fixture list. The user answers per date, not per fixture.
      const byDate = new Map<string, Fixture[]>();
      for (const f of item.fixtures) {
        const list = byDate.get(f.match_date) ?? [];
        list.push(f);
        byDate.set(f.match_date, list);
      }
      const answered = new Set(item.myResponses.map((r) => r.match_date));
      for (const [date, fixtures] of byDate) {
        if (answered.has(date)) continue;
        out.push({ requestId: item.id, date, fixtures });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [data]);

  // Snapshot the unanswered step set once data first loads with at least
  // one entry. We invalidate the availability query after each save so
  // the home card stays fresh, but the refetch removes the just-answered
  // date from `computedSteps` - without this snapshot the list shrinks
  // under us and bounces the user to the "all done" screen after the
  // first answer. (Setting state from render is the documented React
  // pattern for "store info from previous renders"; the conditional
  // makes it idempotent.)
  const [snapshot, setSnapshot] = useState<Step[] | null>(null);
  if (snapshot === null && computedSteps.length > 0) {
    setSnapshot(computedSteps);
  }
  const flowSteps = snapshot ?? computedSteps;

  // Available-so-far counts come back fresh on every refetch (we want
  // these to update as other players answer), so they're keyed off the
  // live `data` rather than the snapshotted `flowSteps`.
  const availableCountByKey = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const item of data?.items ?? []) {
      for (const c of item.availableCounts) {
        m.set(`${item.id}:${c.match_date}`, c.count);
      }
    }
    return m;
  }, [data]);

  const [stepIndex, setStepIndex] = useState(0);
  const [note, setNote] = useState("");
  const current = flowSteps[stepIndex];
  const currentAvailableCount = current
    ? (availableCountByKey.get(`${current.requestId}:${current.date}`) ?? 0)
    : 0;

  // Player-side endpoint — gated on requireAuth, accepts a batch of
  // { matchDate, status, note? } per request. Per-date PUT is the
  // official override path; using it as a player returned 403.
  const respond = useMutation({
    mutationFn: (vars: {
      requestId: string;
      responses: Array<{
        matchDate: string;
        status: "available" | "unavailable";
        note?: string;
      }>;
    }) =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/respond", {
          params: { path: { requestId: vars.requestId } },
          body: { responses: vars.responses },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  async function pick(answer: "available" | "unavailable") {
    if (!current) return;
    const noteTrim = note.trim();
    await respond.mutateAsync({
      requestId: current.requestId,
      responses: [
        {
          matchDate: current.date,
          status: answer,
          ...(noteTrim && { note: noteTrim }),
        },
      ],
    });
    setNote("");
    setStepIndex((prev) => Math.min(prev + 1, flowSteps.length));
  }

  if (isLoading) {
    return (
      <FlowFrame>
        <div className="mx-auto w-full max-w-md px-5 py-12">
          <div className="bg-border h-6 w-1/3 rounded-md" />
          <div className="bg-border mt-4 h-32 rounded-2xl" />
          <div className="bg-border mt-4 h-32 rounded-2xl" />
        </div>
      </FlowFrame>
    );
  }
  if (isError) {
    return (
      <FlowFrame>
        <div className="mx-auto max-w-md px-6 py-12 text-center">
          <h1 className="text-lg font-semibold">Couldn't load availability</h1>
          <p className="text-text-secondary mt-2 text-sm">
            Try again in a moment.
          </p>
          <Button asChild tone="outline" className="mt-4 inline-flex">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </FlowFrame>
    );
  }
  if (flowSteps.length === 0) {
    return (
      <FlowFrame>
        <EmptyDone
          title="You're all caught up"
          body="No open availability requests right now. We'll let you know."
          onBack={() => {
            void navigate("/");
          }}
        />
      </FlowFrame>
    );
  }
  if (stepIndex >= flowSteps.length || !current) {
    return (
      <FlowFrame>
        <EmptyDone
          title="All done"
          body="See you on the pitch."
          onBack={() => {
            void navigate("/");
          }}
          icon="check"
        />
      </FlowFrame>
    );
  }

  const total = flowSteps.length;
  return (
    <FlowFrame>
      <header className="border-border flex items-center gap-3 border-b p-3">
        <button
          type="button"
          onClick={() => {
            void navigate("/");
          }}
          aria-label="Back"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {flowSteps.map((s, i) => (
            <span
              key={`${s.requestId}:${s.date}`}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < stepIndex
                  ? "bg-success"
                  : i === stepIndex
                    ? "bg-navy"
                    : "bg-border",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigate("/");
          }}
          className="text-text-secondary text-xs font-medium"
        >
          Skip all →
        </button>
      </header>
      <div className="mx-auto w-full max-w-md px-5 py-6">
        <div className="flex items-baseline justify-between">
          <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            {fmtDate(current.date, "EEEE")}
          </span>
          <span className="text-text-secondary text-xs">
            {stepIndex + 1} of {total}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em]">
          {fmtDate(current.date, "d MMMM")}
        </h1>

        <div className="mt-4 space-y-2">
          {current.fixtures.map((f) => (
            <div
              key={f.id}
              className="border-border bg-surface-raised rounded-xl border p-3"
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  {[f.team_name, "vs", f.opposition].filter(Boolean).join(" ")}
                </strong>
                {f.competition_name && (
                  <span className="text-text-secondary text-[11px] font-semibold tracking-wider uppercase">
                    {f.competition_name}
                  </span>
                )}
              </div>
              <div className="text-text-secondary mt-1 text-xs">
                {[f.is_home ? "Home" : "Away", f.match_time]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          ))}
        </div>

        <p className="text-text-secondary mt-3 text-xs">
          {currentAvailableCount}{" "}
          {currentAvailableCount === 1 ? "player is" : "players are"} available
          so far
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => {
              void pick("available");
            }}
            className="border-success/15 bg-success-bg text-success flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 text-lg font-bold disabled:opacity-60"
          >
            <CheckIcon className="size-8" strokeWidth={2.4} />
            Available
          </button>
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => {
              void pick("unavailable");
            }}
            className="border-danger/15 bg-danger-bg text-danger flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 text-lg font-bold disabled:opacity-60"
          >
            <XIcon className="size-8" strokeWidth={2.4} />
            Unavailable
          </button>
        </div>

        <div className="border-border bg-surface mt-4 rounded-xl border px-4 py-3">
          <label
            htmlFor="note"
            className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase"
          >
            Optional note
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="e.g. free after 1pm"
            className="placeholder:text-text-muted mt-1 w-full bg-transparent text-sm outline-none"
          />
        </div>

        {respond.isError && (
          <p className="text-danger mt-4 flex items-center gap-1.5 text-sm">
            <CircleAlertIcon className="size-4" />
            Couldn't save, try again.
          </p>
        )}
      </div>
    </FlowFrame>
  );
}

function EmptyDone({
  title,
  body,
  onBack,
  icon,
}: {
  title: string;
  body: string;
  onBack: () => void;
  icon?: "check";
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-20 text-center">
      <div
        className={cn(
          "grid size-20 place-items-center rounded-full",
          icon === "check"
            ? "bg-success-bg text-success"
            : "bg-border text-text-secondary",
        )}
      >
        <CheckIcon className="size-10" strokeWidth={2.4} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.015em]">
        {title}
      </h1>
      <p className="text-text-secondary mt-1 text-sm">{body}</p>
      <Button tone="primary" className="mt-6 w-full max-w-xs" onClick={onBack}>
        Back to home
      </Button>
    </div>
  );
}

function FlowFrame({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface flex min-h-full flex-col">{children}</div>;
}
