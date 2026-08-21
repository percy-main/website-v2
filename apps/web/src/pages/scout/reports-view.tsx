import { Button } from "@/components/ui/button";
import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import type { ReportData } from "@percy-main/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ReportCard } from "./report-card.tsx";

const REPORTS_QUERY_KEY = ["scout", "reports"] as const;

interface ReportRow {
  id: string;
  threadId: string;
  threadTitle: string | null;
  title: string;
  fileSizeBytes: number | null;
  createdAt: string;
  status: "queued" | "generating" | "ready" | "failed";
  startedAt: number | null;
}

const IN_FLIGHT_POLL_MS = 10_000;

export function ReportsView() {
  const {
    data: reportsData,
    isLoading,
    error,
  } = useAuthedQuery({
    queryKey: REPORTS_QUERY_KEY,
    queryFn: () => callApi(api.GET("/api/scout/reports")),
    // Listing-level poll catches new reports queued from other tabs and
    // catches a queued→ready transition for rows that didn't have a card
    // mounted (and so weren't being polled individually). Once everything
    // is settled the polling stops.
    refetchInterval: (q) =>
      q.state.data?.reports.some(
        (r: ReportRow) => r.status === "queued" || r.status === "generating",
      )
        ? IN_FLIGHT_POLL_MS
        : false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-stone-500">
        Loading reports…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">
        {error instanceof Error ? error.message : "Failed to load reports"}
      </div>
    );
  }

  const reports = reportsData?.reports ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Reports</h2>
      {reports.length === 0 ? (
        <div className="mt-12 text-center text-sm text-stone-500">
          No reports yet. In a scouting thread, click{" "}
          <strong>Generate report</strong> in the composer to create one.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {reports.map((r) => (
            <ReportListItem key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportListItem({ report }: { report: ReportRow }) {
  // Construct a `ReportData`-shaped payload from the row. ReportCard polls
  // /api/scout/reports/:id internally, so the per-card live state (phases,
  // recentToolCalls, errorMessage) overrides this placeholder once the
  // first poll resolves.
  const placeholder: ReportData = {
    reportId: report.id,
    title: report.title,
    fileSizeBytes: report.fileSizeBytes,
    createdAt: report.createdAt,
    status: report.status,
    startedAt: report.startedAt ?? undefined,
  };
  return (
    <div>
      <ReportCard data={placeholder} />
      <ReportFooter report={report} />
    </div>
  );
}

function ReportFooter({ report }: { report: ReportRow }) {
  const created = new Date(report.createdAt);
  return (
    <div className="-mt-1 flex items-center justify-between gap-2 px-3 pb-2 text-[11px] text-stone-600">
      <div className="min-w-0 truncate">
        {created.toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {report.threadTitle && (
          <>
            {" · "}
            <Link
              to={`/scout/${report.threadId}`}
              className="text-blue-700 hover:underline"
            >
              {report.threadTitle}
            </Link>
          </>
        )}
      </div>
      {report.status === "ready" && <DeleteReportButton reportId={report.id} />}
    </div>
  );
}

function DeleteReportButton({ reportId }: { reportId: string }) {
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();
  const deleteMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.DELETE("/api/scout/reports/{reportId}", {
          params: { path: { reportId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: authedKey(REPORTS_QUERY_KEY),
      });
    },
  });
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        if (!confirm("Delete this report? This cannot be undone.")) return;
        deleteMutation.mutate();
      }}
      disabled={deleteMutation.isPending}
      className="h-6 px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      {deleteMutation.isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
