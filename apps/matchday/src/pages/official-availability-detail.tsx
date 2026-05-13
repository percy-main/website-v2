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
    competition?: string | null;
    away?: boolean;
  }>;
  available: number;
  unavailable: number;
  noResponse: number;
}

interface DetailResponse {
  id: string;
  date_from: string;
  date_to: string;
  status: string;
  dates: DateSummary[];
}

/**
 * Phase 3 availability-request detail.
 *
 * Renders a list of dates in the range, each linking to the per-date
 * picker. Top-line summary shows total counts. Close-request and
 * notify-non-responders actions live in the footer.
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

  const req = data as unknown as DetailResponse;
  const totalAvailable = req.dates.reduce((acc, d) => acc + d.available, 0);
  const totalUnavailable = req.dates.reduce(
    (acc, d) => acc + d.unavailable,
    0,
  );
  const totalNoResponse = req.dates.reduce((acc, d) => acc + d.noResponse, 0);

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
            {fmtDate(req.date_from, "d MMM")} – {fmtDate(req.date_to, "d MMM")}
          </strong>
          <p className="text-[11px] text-text-secondary">
            {req.dates.length} date{req.dates.length === 1 ? "" : "s"}
          </p>
        </div>
        <StatusPill
          tone={req.status === "open" ? "warning" : "neutral"}
          dot
          className="ml-auto"
        >
          {req.status}
        </StatusPill>
      </header>

      <section className="grid grid-cols-3 gap-2 px-4 pt-4">
        <Summary tone="success" label="Available" count={totalAvailable} />
        <Summary tone="danger" label="Unavailable" count={totalUnavailable} />
        <Summary tone="neutral" label="No response" count={totalNoResponse} />
      </section>

      <section className="space-y-2 px-4 py-4">
        {req.dates.map((d) => (
          <Link
            key={d.date}
            to={`/official/availability/${req.id}/date/${d.date}`}
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
            <div className="mt-2 flex gap-2 text-[11px]">
              <span className="rounded bg-success-bg px-2 py-0.5 text-success">
                {d.available} available
              </span>
              <span className="rounded bg-danger-bg px-2 py-0.5 text-danger">
                {d.unavailable} unavailable
              </span>
              <span className="rounded bg-border px-2 py-0.5 text-text-secondary">
                {d.noResponse} no resp.
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
          {req.status === "open" && (
            <>
              <Button
                tone="destructive"
                className="flex-1"
                disabled={close.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Close this request? ${totalNoResponse} ${totalNoResponse === 1 ? "person hasn't" : "people haven't"} answered yet.`,
                    )
                  ) {
                    close.mutate();
                  }
                }}
              >
                Close request
              </Button>
            </>
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
  tone: "success" | "danger" | "neutral";
  label: string;
  count: number;
}) {
  const bg = {
    success: "bg-success-bg text-success",
    danger: "bg-danger-bg text-danger",
    neutral: "bg-border text-text-secondary",
  }[tone];
  return (
    <div className={`${bg} rounded-2xl px-3 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em]">
        {label}
      </p>
      <p className="text-xl font-semibold tracking-[-0.01em]">{count}</p>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2 px-4 py-4">
      <div className="h-16 rounded-xl bg-border" />
      <div className="h-20 rounded-2xl bg-border" />
      <div className="h-20 rounded-2xl bg-border" />
    </div>
  );
}
