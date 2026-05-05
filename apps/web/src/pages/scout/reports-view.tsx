import { Button } from "@/components/ui/button";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { downloadScoutReport } from "./download-report.ts";

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
  const reportsQuery = useQuery({
    queryKey: REPORTS_QUERY_KEY,
    queryFn: () => callApi(api.GET("/api/scout/reports")),
    // While any row is in flight, poll the listing so an in-progress
    // report's status updates without manual refresh. Once everything
    // is settled we drop back to no polling.
    refetchInterval: (q) =>
      q.state.data?.reports.some(
        (r: ReportRow) => r.status === "queued" || r.status === "generating",
      )
        ? IN_FLIGHT_POLL_MS
        : false,
  });

  if (reportsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        Loading reports…
      </div>
    );
  }

  if (reportsQuery.error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">
        {reportsQuery.error instanceof Error
          ? reportsQuery.error.message
          : "Failed to load reports"}
      </div>
    );
  }

  const reports = reportsQuery.data?.reports ?? [];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <h2 className="mb-3 text-sm font-medium text-gray-700">
        Historical reports
      </h2>
      {reports.length === 0 ? (
        <div className="mt-12 text-center text-sm text-gray-500">
          No reports yet. In a scouting thread, click{" "}
          <strong>Generate report</strong> in the composer to create one.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
          {reports.map((r) => (
            <ReportListItem key={r.id} report={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportListItem({ report }: { report: ReportRow }) {
  if (report.status !== "ready")
    return <InFlightReportListItem report={report} />;
  return <ReadyReportListItem report={report} />;
}

function InFlightReportListItem({ report }: { report: ReportRow }) {
  const elapsed = report.startedAt
    ? Math.max(0, Math.floor((Date.now() - report.startedAt) / 1000))
    : null;
  const elapsedLabel =
    elapsed === null
      ? "queued"
      : elapsed < 60
        ? `${elapsed}s`
        : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-600 text-[10px] font-semibold text-white">
        …
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={`/scout/${report.threadId}`}
          className="block truncate text-sm font-medium text-gray-900 hover:underline"
        >
          {report.title}
        </Link>
        <div className="text-[11px] text-gray-600">
          {report.status === "queued" ? "Queued" : "Generating"} ·{" "}
          {elapsedLabel}
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
      </div>
    </li>
  );
}

function ReadyReportListItem({ report }: { report: ReportRow }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.DELETE("/api/scout/reports/{reportId}", {
          params: { path: { reportId: report.id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REPORTS_QUERY_KEY });
    },
  });

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      await downloadScoutReport(report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${report.title}"? This cannot be undone.`)) return;
    deleteMutation.mutate();
  };

  const sizeKb =
    report.fileSizeBytes !== null
      ? Math.max(1, Math.round(report.fileSizeBytes / 1024))
      : null;
  const created = new Date(report.createdAt);

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-600 text-[10px] font-semibold text-white">
        PDF
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">
          {report.title}
        </div>
        <div className="text-[11px] text-gray-600">
          {created.toLocaleString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {sizeKb !== null && <> · {sizeKb} KB</>}
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
        {error && <div className="mt-1 text-[11px] text-red-700">{error}</div>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void handleDownload();
        }}
        disabled={downloading}
      >
        {downloading ? "Opening…" : "Download"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        disabled={deleteMutation.isPending}
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        {deleteMutation.isPending ? "…" : "Delete"}
      </Button>
    </li>
  );
}
