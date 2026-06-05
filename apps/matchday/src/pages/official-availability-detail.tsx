import { StatusPill } from "@/components/primitives/status-pill.js";
import { StickyActionBar } from "@/components/shell/sticky-action-bar.js";
import { Button } from "@/components/ui/button.js";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

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
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
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
      <p className="text-text-secondary px-4 py-6 text-sm">
        Couldn't load the request.
      </p>
    );

  const { request, dates } = data;
  const totalResponses = dates.reduce((acc, d) => acc + d.responseCount, 0);
  const totalAssignments = dates.reduce((acc, d) => acc + d.assignmentCount, 0);
  const totalFixtures = dates.reduce((acc, d) => acc + d.fixtures.length, 0);

  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to="/official/availability"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div>
          <strong className="text-sm">
            {fmtDate(request.date_from, "d MMM")} –{" "}
            {fmtDate(request.date_to, "d MMM")}
          </strong>
          <p className="text-text-secondary text-[11px]">
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
            className="border-border bg-surface block rounded-2xl border p-4"
          >
            <div className="flex items-baseline justify-between">
              <strong className="text-sm font-semibold">
                {fmtDate(d.date, "EEE d MMM")}
              </strong>
              <span className="text-text-secondary text-[11px]">
                {d.fixtures.length} fixture{d.fixtures.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {d.fixtures.map((f) => (
                <li key={f.id} className="text-text-secondary">
                  <span className="text-text font-medium">
                    {f.team_name ? `${f.team_name} ` : ""}vs {f.opposition}
                  </span>
                  <span>
                    {" · "}
                    {[f.is_home ? "Home" : "Away", f.competition_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="bg-info-bg text-navy rounded px-2 py-0.5 dark:text-white">
                {d.responseCount} response
                {d.responseCount === 1 ? "" : "s"}
              </span>
              <span className="bg-success-bg text-success rounded px-2 py-0.5">
                {d.assignmentCount} assigned
              </span>
              {d.confirmedCount > 0 && (
                <span className="bg-success text-surface rounded px-2 py-0.5 font-semibold">
                  {d.confirmedCount} of {d.fixtures.length} confirmed
                </span>
              )}
            </div>
          </Link>
        ))}
      </section>

      {request.status === "open" && (
        <StickyActionBar>
          <Button
            tone="destructive"
            className="flex-1"
            disabled={close.isPending}
            onClick={() => {
              setConfirmCloseOpen(true);
            }}
          >
            Close request
          </Button>
        </StickyActionBar>
      )}

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title="Close this request?"
        description="Players won't be able to respond after this, and any picked-but-unconfirmed teams will be turned into matchdays."
        confirmLabel="Close request"
        confirmTone="destructive"
        pending={close.isPending}
        onConfirm={() => {
          close.mutate(undefined, {
            onSuccess: () => {
              setConfirmCloseOpen(false);
            },
          });
        }}
      />
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
      <p className="text-[10px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </p>
      <p className="text-xl font-semibold tracking-[-0.01em]">{count}</p>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2 p-4">
      <div className="bg-border h-16 rounded-xl" />
      <div className="bg-border h-20 rounded-2xl" />
      <div className="bg-border h-20 rounded-2xl" />
    </div>
  );
}
