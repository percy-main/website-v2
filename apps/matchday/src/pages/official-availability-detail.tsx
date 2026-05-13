import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router";

interface DateSummary {
  date: string;
  fixtures: Array<{
    teamName?: string | null;
    opposition?: string | null;
    competition_name?: string | null;
    is_home?: boolean;
  }>;
  responseCount: number;
  assignmentCount: number;
}

interface DetailResponse {
  request: {
    id: string;
    date_from: string;
    date_to: string;
    status: string;
  };
  dates: DateSummary[];
}

/**
 * Phase 3 availability-request detail.
 *
 * Renders the dates in the range with per-date response + assignment
 * counts (the breakdown into available/unavailable/no-response only
 * lives on the per-date endpoint — see the per-date picker page).
 * Total cards at the top aggregate across dates.
 */
export default function OfficialAvailabilityDetail() {
  const { requestId } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "request", requestId],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests/{requestId}", {
          params: { path: { requestId: requestId ?? "" } },
        }),
      ),
    enabled: !!requestId,
  });

  const close = useMutation({
    mutationFn: () =>
      callApi(
        api.PATCH("/api/availability/requests/{requestId}", {
          params: { path: { requestId: requestId ?? "" } },
          body: { status: "closed" },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  if (isLoading) return <Skel />;
  if (isError || !data)
    return (
      <p className="px-4 py-6 text-sm text-text-secondary">
        Couldn't load the request.
      </p>
    );

  const detail = data as unknown as DetailResponse;
  const { request, dates } = detail;
  const totalResponses = dates.reduce(
    (acc, d) => acc + (d.responseCount ?? 0),
    0,
  );
  const totalAssignments = dates.reduce(
    (acc, d) => acc + (d.assignmentCount ?? 0),
    0,
  );
  const totalFixtures = dates.reduce(
    (acc, d) => acc + d.fixtures.length,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <header className="flex items-center gap-3 border-b border-border p-3">
        <Link
          to="/official/availability"
          className="grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-raised"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div>
          <strong className="text-sm">
            {fmtDate(request.date_from, "d MMM")} –{" "}
            {fmtDate(request.date_to, "d MMM")}
          </strong>
          <p className="text-[11px] text-text-secondary">
            {dates.length} date{dates.length === 1 ? "" : "s"}
          </p>
        </div>
        <StatusPill
          tone={request.status === "open" ? "warning" : "neutral"}
          dot
          className="ml-auto"
        >
          {request.status}
        </StatusPill>
      </header>

      <section className="grid grid-cols-3 gap-2 px-4 pt-4">
        <Summary tone="navy" label="Responses" count={totalResponses} />
        <Summary tone="success" label="Assigned" count={totalAssignments} />
        <Summary tone="neutral" label="Fixtures" count={totalFixtures} />
      </section>

      <section className="space-y-2 px-4 py-4">
        {dates.map((d) => (
          <Link
            key={d.date}
            to={`/official/availability/${request.id}/date/${d.date}`}
            className="block rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex items-baseline justify-between">
              <strong className="text-sm font-semibold">
                {fmtDate(d.date, "EEE d MMM")}
              </strong>
              <span className="text-[11px] text-text-secondary">
                {d.fixtures.length} fixture{d.fixtures.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-info-bg px-2 py-0.5 text-navy dark:text-white">
                {d.responseCount ?? 0} response
                {(d.responseCount ?? 0) === 1 ? "" : "s"}
              </span>
              <span className="rounded bg-success-bg px-2 py-0.5 text-success">
                {d.assignmentCount ?? 0} assigned
              </span>
            </div>
          </Link>
        ))}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:static">
        <div
          className={cn(
            "mx-auto flex max-w-2xl items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3",
          )}
        >
          {request.status === "open" && (
            <Button
              tone="destructive"
              className="flex-1"
              disabled={close.isPending}
              onClick={() => {
                if (confirm("Close this request? Players won't be able to respond after this.")) {
                  close.mutate();
                }
              }}
            >
              Close request
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({
  tone,
  label,
  count,
}: {
  tone: "success" | "danger" | "neutral" | "navy";
  label: string;
  count: number;
}) {
  const bg = {
    success: "bg-success-bg text-success",
    danger: "bg-danger-bg text-danger",
    neutral: "bg-border text-text-secondary",
    navy: "bg-info-bg text-navy dark:text-white",
  }[tone];
  return (
    <div className={`${bg} rounded-2xl p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em]">
        {label}
      </p>
      <p className="text-xl font-semibold tracking-[-0.01em]">{count}</p>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2 p-4">
      <div className="h-16 rounded-xl bg-border" />
      <div className="h-20 rounded-2xl bg-border" />
      <div className="h-20 rounded-2xl bg-border" />
    </div>
  );
}
