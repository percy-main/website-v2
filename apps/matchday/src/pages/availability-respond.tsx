import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

/**
 * Phase 2 availability response flow.
 *
 * Reads /api/availability/active. Flattens across all active requests into
 * an ordered list of unanswered dates, asks the player about each one,
 * optimistically commits via the per-date members availability endpoint.
 *
 * Per the plan: tap-not-swipe, both available/unavailable buttons on the
 * same screen, optional note, "apply same to all remaining" power user
 * affordance, end-state celebration.
 */

interface ActiveRequest {
  id: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
  member?: { id: string };
  dates: ActiveDate[];
}
interface ActiveDate {
  date: string;
  fixtures?: Array<{
    teamName?: string;
    opposition?: string;
    competition?: string;
    away?: boolean;
  }>;
  myResponse?: "available" | "unavailable" | null;
  myNote?: string | null;
}

interface StepRef {
  requestId: string;
  memberId: string;
  date: ActiveDate;
}

export default function AvailabilityRespond() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });

  const steps = useMemo<StepRef[]>(() => {
    const reqs =
      (data as unknown as { requests?: ActiveRequest[] } | undefined)
        ?.requests ?? [];
    // Single pass: walk active requests, push unanswered date refs.
    const out: StepRef[] = [];
    for (const r of reqs) {
      if (r.status !== "open") continue;
      for (const d of r.dates) {
        if (d.myResponse !== null && d.myResponse !== undefined) continue;
        out.push({
          requestId: r.id,
          memberId: r.member?.id ?? "",
          date: d,
        });
      }
    }
    out.sort((a, b) => a.date.date.localeCompare(b.date.date));
    return out;
  }, [data]);

  const [stepIndex, setStepIndex] = useState(0);
  const [note, setNote] = useState("");
  const current = steps[stepIndex];

  const respond = useMutation({
    mutationFn: async ({
      requestId,
      memberId,
      date,
      answer,
      reason,
    }: {
      requestId: string;
      memberId: string;
      date: string;
      answer: "available" | "unavailable";
      reason?: string;
    }) =>
      callApi(
        api.PUT(
          "/api/availability/requests/{requestId}/dates/{date}/members/{memberId}/availability",
          {
            params: {
              path: { requestId, date, memberId },
            },
            body: { availability: answer, reason: reason ?? null } as never,
          },
        ),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  async function pick(answer: "available" | "unavailable") {
    if (!current) return;
    await respond.mutateAsync({
      requestId: current.requestId,
      memberId: current.memberId,
      date: current.date.date,
      answer,
      reason: note.trim() || undefined,
    });
    setNote("");
    setStepIndex((prev) => Math.min(prev + 1, steps.length));
  }

  async function applyToAllRemaining(answer: "available" | "unavailable") {
    const remaining = steps.slice(stepIndex);
    // Fire requests in parallel — each date is independent on the server.
    await Promise.all(
      remaining.map((s) =>
        respond.mutateAsync({
          requestId: s.requestId,
          memberId: s.memberId,
          date: s.date.date,
          answer,
        }),
      ),
    );
    setStepIndex(steps.length);
  }

  if (isLoading) {
    return (
      <FlowFrame>
        <div className="mx-auto w-full max-w-md px-5 py-12">
          <div className="h-6 w-1/3 rounded-md bg-border" />
          <div className="mt-4 h-32 rounded-2xl bg-border" />
          <div className="mt-4 h-32 rounded-2xl bg-border" />
        </div>
      </FlowFrame>
    );
  }
  if (isError) {
    return (
      <FlowFrame>
        <div className="mx-auto max-w-md px-6 py-12 text-center">
          <h1 className="text-lg font-semibold">Couldn't load availability</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Try again in a moment.
          </p>
          <Button asChild tone="outline" className="mt-4 inline-flex">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </FlowFrame>
    );
  }
  if (steps.length === 0) {
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
  if (stepIndex >= steps.length || !current) {
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

  const total = steps.length;
  return (
    <FlowFrame>
      <header className="flex items-center gap-3 border-b border-border p-3">
        <button
          type="button"
          onClick={() => {
            void navigate("/");
          }}
          aria-label="Back"
          className="grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-raised"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {steps.map((s, i) => (
            <span
              key={`${s.requestId}:${s.date.date}`}
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
          className="text-xs font-medium text-text-secondary"
        >
          Skip all →
        </button>
      </header>
      <div className="mx-auto w-full max-w-md px-5 py-6">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            {fmtDate(current.date.date, "EEEE")}
          </span>
          <span className="text-xs text-text-secondary">
            {stepIndex + 1} of {total}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em]">
          {fmtDate(current.date.date, "d MMMM")}
        </h1>

        <div className="mt-4 space-y-2">
          {(current.date.fixtures ?? []).map((f) => (
            <div
              key={`${f.teamName ?? ""}:${f.opposition ?? ""}`}
              className="rounded-xl border border-border bg-surface-raised p-3"
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  {[f.teamName, "vs", f.opposition].filter(Boolean).join(" ")}
                </strong>
                {f.competition && (
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                    {f.competition}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                {f.away ? "Away" : "Home"}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => {
              void pick("available");
            }}
            className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-success/15 bg-success-bg text-lg font-bold text-success disabled:opacity-60"
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
            className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-danger/15 bg-danger-bg text-lg font-bold text-danger disabled:opacity-60"
          >
            <XIcon className="size-8" strokeWidth={2.4} />
            Unavailable
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
          <label
            htmlFor="note"
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary"
          >
            Optional note
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="e.g. free after 1pm"
            className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
          />
        </div>

        {steps.length - stepIndex > 1 && (
          <div className="mt-6 flex flex-col items-center gap-1 text-center">
            <button
              type="button"
              onClick={() => {
                void applyToAllRemaining("available");
              }}
              className="text-xs font-medium text-text-secondary underline"
            >
              Apply Available to all {steps.length - stepIndex} remaining
            </button>
            <button
              type="button"
              onClick={() => {
                void applyToAllRemaining("unavailable");
              }}
              className="text-xs font-medium text-text-secondary underline"
            >
              Apply Unavailable to all {steps.length - stepIndex} remaining
            </button>
          </div>
        )}

        {respond.isError && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-danger">
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
      <p className="mt-1 text-sm text-text-secondary">{body}</p>
      <Button tone="primary" className="mt-6 w-full max-w-xs" onClick={onBack}>
        Back to home
      </Button>
    </div>
  );
}

function FlowFrame({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-surface">{children}</div>;
}
