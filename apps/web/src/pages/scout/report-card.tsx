import { type ReportData } from "@percy-main/shared";
import { useEffect, useState } from "react";
import { downloadScoutReport } from "./download-report.ts";
import { useCancelReport, useReportDetail } from "./use-report-detail.ts";

// Three rendering modes driven off data.status:
//   - generating / queued: ReportLoadingCard — single loading box with
//     spinner, title, elapsed time, and a Stop button.
//   - ready: ReportReadyCard — file size + download CTA.
//   - failed: ReportFailedCard — error message + title.

export function ReportCard({ data }: { data: ReportData }) {
  // Streamed `data` is just a marker — reportId + title + initial 'queued'
  // status. The polling hook is authoritative; we only fall back to `data`
  // while the first poll is in flight. Once any poll resolves, `live` wins
  // even if the request later goes stale.
  const { data: live } = useReportDetail(data.reportId);
  const view: ReportData = live ?? data;
  if (view.status === "ready" && view.fileSizeBytes != null) {
    return <ReportReadyCard data={view} />;
  }
  if (view.status === "failed") return <ReportFailedCard data={view} />;
  return <ReportLoadingCard data={view} />;
}

// ── Loading ─────────────────────────────────────────────────────────────────

function ReportLoadingCard({ data }: { data: ReportData }) {
  const cancel = useCancelReport(data.reportId);
  const headlineLabel =
    data.status === "queued"
      ? "Queued — waiting to start"
      : "Building scouting report";
  // Prefer the worker's started_at (set when the agent loop begins). Before
  // that, fall back to createdAt — gives the user a ticking elapsed counter
  // from the moment the row hit the DB rather than a frozen empty space.
  const elapsedFrom = data.startedAt ?? Date.parse(data.createdAt);

  return (
    <div className="my-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Spinner />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-emerald-900">
              {headlineLabel}
            </div>
            <div className="truncate text-[11px] text-emerald-900/70">
              {data.title}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Number.isFinite(elapsedFrom) && <Elapsed startedAt={elapsedFrom} />}
          <button
            type="button"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancel.isPending ? "Cancelling…" : "Stop"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 shrink-0 animate-spin text-emerald-700"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 font-mono text-[11px] text-emerald-900/70">
      {formatElapsed(now - startedAt)}
    </span>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Ready ───────────────────────────────────────────────────────────────────

function ReportReadyCard({ data }: { data: ReportData }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      await downloadScoutReport(data.reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const sizeKb =
    data.fileSizeBytes !== null
      ? Math.max(1, Math.round(data.fileSizeBytes / 1024))
      : null;

  return (
    <div className="my-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded bg-blue-600 text-xs font-semibold text-white">
          PDF
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-stone-900">
            {data.title}
          </div>
          <div className="text-[11px] text-stone-600">
            Scouting report{sizeKb !== null && <> · {sizeKb} KB</>}
          </div>
          {error && (
            <div className="mt-1 text-[11px] text-red-700">{error}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void handleDownload();
          }}
          disabled={downloading}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {downloading ? "Opening…" : "Download"}
        </button>
      </div>
    </div>
  );
}

// ── Failed ──────────────────────────────────────────────────────────────────

function ReportFailedCard({ data }: { data: ReportData }) {
  return (
    <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded bg-red-600 text-xs font-semibold text-white">
          ✗
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-red-900">
            Generation failed
          </div>
          <div className="truncate text-[11px] text-red-900/70">
            {data.title}
          </div>
        </div>
      </div>
      {data.errorMessage && (
        <div className="mt-2 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-800">
          {data.errorMessage}
        </div>
      )}
    </div>
  );
}
