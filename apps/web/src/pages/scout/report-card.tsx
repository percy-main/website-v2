import {
  REPORT_PHASE_BUDGETS_MS,
  type ReportData,
  type ReportPhaseName,
  type ReportPhaseState,
  type ReportToolCallEvent,
} from "@percy-main/shared";
import React, { useEffect, useState } from "react";
import { downloadScoutReport } from "./download-report.ts";
import { useCancelReport, useReportDetail } from "./use-report-detail.ts";

// Three rendering modes driven off data.status:
//   - generating: ReportPipelineCard — three sequenced phase boxes with
//     fly-out tool-call chips, pulsing arrow into the active phase, and a
//     countdown to the configured budget for the active phase.
//   - ready: ReportReadyCard — compact timing strip ("✓ 47 records · ✓ 12
//     claims · ✓ 184 KB") above the download CTA.
//   - failed: ReportFailedCard — pipeline view (so the user sees which phase
//     broke) plus the error message.

const PHASE_BUDGETS_MS = REPORT_PHASE_BUDGETS_MS;

const PHASE_LABELS: Record<ReportPhaseName, string> = {
  researcher: "Retrieve data",
  analyst: "Analyse data",
  render: "Build report",
};

const PHASE_ICONS: Record<ReportPhaseName, string> = {
  researcher: "🔍",
  analyst: "🧠",
  render: "📄",
};

const PHASE_ORDER: ReportPhaseName[] = ["researcher", "analyst", "render"];

export function ReportCard({ data }: { data: ReportData }) {
  // Streamed `data` is just a marker — reportId + title + initial 'queued'
  // status. The polling hook is authoritative; we only fall back to `data`
  // while the first poll is in flight. Once any poll resolves, `live` wins
  // even if the request later goes stale.
  const { data: live } = useReportDetail(data.reportId);
  const view: ReportData = live ?? data;
  // ReadyCard requires a non-null fileSizeBytes — if the streamed snapshot
  // is stale (e.g. legacy "ready" placeholder from before the worker
  // rewrite, or a row we cleared from the DB), fall through to the pipeline
  // card so the user sees an honest in-flight indicator instead of a broken
  // Download button.
  if (view.status === "ready" && view.fileSizeBytes != null) {
    return <ReportReadyCard data={view} />;
  }
  if (view.status === "failed") return <ReportFailedCard data={view} />;
  return <ReportPipelineCard data={view} />;
}

// ── Pipeline (generating) ───────────────────────────────────────────────────

function ReportPipelineCard({ data }: { data: ReportData }) {
  const cancel = useCancelReport(data.reportId);
  const headlineLabel =
    data.status === "queued"
      ? "Queued — waiting to start"
      : "Building scouting report";
  // Prefer the worker's started_at (set when researcher actually begins).
  // Before the worker fires we fall back to createdAt — gives the user a
  // ticking elapsed counter from the moment the row hit the DB rather
  // than a frozen empty space.
  const elapsedFrom = data.startedAt ?? Date.parse(data.createdAt);

  return (
    <div className="my-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
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
          {Number.isFinite(elapsedFrom) && (
            <GlobalElapsed startedAt={elapsedFrom} />
          )}
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
      <PipelineRow data={data} />
    </div>
  );
}

function PipelineRow({ data }: { data: ReportData }) {
  // Pad each phase with a sensible default so the card still renders if a
  // partial snapshot arrives (race between the FE rerender and the next BE
  // emit).
  const phases = data.phases ?? {
    researcher: { state: "active" as const },
    analyst: { state: "pending" as const },
    render: { state: "pending" as const },
  };

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
      {PHASE_ORDER.map((phase, i) => (
        <React.Fragment key={phase}>
          <div className="relative flex-1">
            <PhaseBox
              phase={phase}
              state={phases[phase]}
              recentToolCalls={(data.recentToolCalls ?? []).filter(
                (c) => c.phase === phase,
              )}
            />
          </div>
          {i < PHASE_ORDER.length - 1 && (
            <Arrow
              // Pulse the arrow leading into the next phase iff that next
              // phase is currently active. Settles (static muted) once the
              // next phase has finished or failed.
              pulsing={phases[PHASE_ORDER[i + 1]].state === "active"}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function PhaseBox({
  phase,
  state,
  recentToolCalls,
}: {
  phase: ReportPhaseName;
  state: ReportPhaseState;
  recentToolCalls: ReportToolCallEvent[];
}) {
  const isActive = state.state === "active";
  const isDone = state.state === "done";
  const isFailed = state.state === "failed";

  const containerClass = isFailed
    ? "border-red-300 bg-red-50"
    : isDone
      ? "border-emerald-400 bg-white"
      : isActive
        ? "border-emerald-500 bg-white shadow-sm ring-1 ring-emerald-300/60"
        : "border-emerald-200/60 bg-white/40";

  const titleClass = isFailed
    ? "text-red-900"
    : isDone || isActive
      ? "text-emerald-900"
      : "text-emerald-900/50";

  return (
    <div className="relative">
      {isActive && <ToolChipFly events={recentToolCalls} />}
      <div
        className={`relative flex flex-col items-start gap-1 rounded-md border-2 px-3 py-2 transition-colors ${containerClass}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{PHASE_ICONS[phase]}</span>
          <span className={`text-sm font-semibold ${titleClass}`}>
            {PHASE_LABELS[phase]}
          </span>
          {isDone && <span className="text-xs text-emerald-600">✓</span>}
          {isFailed && <span className="text-xs text-red-600">✗</span>}
        </div>
        <PhaseSubtitle phase={phase} state={state} />
      </div>
    </div>
  );
}

function PhaseSubtitle({
  phase,
  state,
}: {
  phase: ReportPhaseName;
  state: ReportPhaseState;
}) {
  if (state.state === "pending") {
    return <div className="text-[11px] text-emerald-900/40">pending</div>;
  }
  if (state.state === "active" && state.startedAt != null) {
    return (
      <ActiveCountdown
        startedAt={state.startedAt}
        budgetMs={PHASE_BUDGETS_MS[phase]}
      />
    );
  }
  if (
    state.state === "done" &&
    state.startedAt != null &&
    state.endedAt != null
  ) {
    const ms = state.endedAt - state.startedAt;
    const summary = (() => {
      if (state.summary?.records != null) {
        return `${state.summary.records} record${state.summary.records === 1 ? "" : "s"}`;
      }
      if (state.summary?.claims != null) {
        return `${state.summary.claims} claim${state.summary.claims === 1 ? "" : "s"}`;
      }
      if (state.summary?.bytes != null) {
        const kb = Math.max(1, Math.round(state.summary.bytes / 1024));
        return `${kb} KB`;
      }
      return null;
    })();
    return (
      <div className="text-[11px] text-emerald-900/70">
        {formatElapsed(ms)}
        {summary ? ` · ${summary}` : ""}
      </div>
    );
  }
  if (state.state === "failed") {
    return <div className="text-[11px] text-red-700">failed</div>;
  }
  return null;
}

function ActiveCountdown({
  startedAt,
  budgetMs,
}: {
  startedAt: number;
  budgetMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = startedAt + budgetMs - now;
  if (remaining > 0) {
    return (
      <div className="text-[11px] text-emerald-900/80">
        ~{formatRemaining(remaining)} remaining
      </div>
    );
  }
  return (
    <div className="text-[11px] text-red-700">
      +{formatElapsed(-remaining)} over budget
    </div>
  );
}

function ToolChipFly({ events }: { events: ReportToolCallEvent[] }) {
  const STALE_MS = 3000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const visible = events.filter((e) => now - e.at < STALE_MS);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute -top-1 right-1 left-1 flex flex-col-reverse items-end gap-0.5">
      {visible.map((event) => (
        <span
          key={event.id}
          className="animate-chip-fly inline-flex max-w-full items-center gap-1 truncate rounded-full border border-emerald-300 bg-white px-2 py-0.5 font-mono text-[10px] text-emerald-800 shadow-sm"
        >
          <span className="text-emerald-500">ⓘ</span>
          <span className="truncate">{event.toolName}</span>
        </span>
      ))}
    </div>
  );
}

function Arrow({ pulsing }: { pulsing: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-center self-center sm:px-1">
      <span
        className={`inline-flex items-center text-emerald-500 ${pulsing ? "animate-arrow-pulse" : "opacity-40"}`}
        aria-hidden="true"
      >
        <ArrowGlyph />
      </span>
    </div>
  );
}

function ArrowGlyph() {
  return (
    <>
      <svg
        className="hidden h-5 w-7 sm:block"
        viewBox="0 0 28 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 10h22m-6-6 6 6-6 6" />
      </svg>
      <svg
        className="block h-7 w-5 sm:hidden"
        viewBox="0 0 20 28"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 2v22m-6-6 6 6 6-6" />
      </svg>
    </>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin text-emerald-700"
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

function GlobalElapsed({ startedAt }: { startedAt: number }) {
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

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Ready (with timing strip) ───────────────────────────────────────────────

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
      {data.phases && <ReadyTimingStrip data={data} />}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-600 text-xs font-semibold text-white">
          PDF
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">
            {data.title}
          </div>
          <div className="text-[11px] text-gray-600">
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

function ReadyTimingStrip({ data }: { data: ReportData }) {
  if (!data.phases) return null;
  const parts: string[] = [];
  for (const phase of PHASE_ORDER) {
    const p = data.phases[phase];
    if (p.state !== "done" || p.startedAt == null || p.endedAt == null)
      continue;
    const ms = p.endedAt - p.startedAt;
    if (phase === "researcher" && p.summary?.records != null) {
      parts.push(`✓ ${p.summary.records} records · ${formatElapsed(ms)}`);
    } else if (phase === "analyst" && p.summary?.claims != null) {
      parts.push(`✓ ${p.summary.claims} claims · ${formatElapsed(ms)}`);
    } else if (phase === "render" && p.summary?.bytes != null) {
      const kb = Math.max(1, Math.round(p.summary.bytes / 1024));
      parts.push(`✓ ${kb} KB · ${formatElapsed(ms)}`);
    } else {
      parts.push(`✓ ${PHASE_LABELS[phase]} · ${formatElapsed(ms)}`);
    }
  }
  if (parts.length === 0) return null;
  return (
    <div className="mb-2 truncate text-[11px] text-blue-900/70">
      {parts.join("  ")}
    </div>
  );
}

// ── Failed ──────────────────────────────────────────────────────────────────

function ReportFailedCard({ data }: { data: ReportData }) {
  return (
    <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-red-600 text-xs font-semibold text-white">
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
      {data.phases && <PipelineRow data={data} />}
      {data.errorMessage && (
        <div className="mt-2 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-800">
          {data.errorMessage}
        </div>
      )}
    </div>
  );
}
