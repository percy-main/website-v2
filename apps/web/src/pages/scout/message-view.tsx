import type { UIMessage } from "@ai-sdk/react";
import {
  REPORT_PHASE_BUDGETS_MS,
  type ChartSpec,
  type ReportPhaseName,
  type ReportPhaseState,
  type ReportToolCallEvent,
  type ReportData as SharedReportData,
} from "@percy-main/shared";
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadScoutReport } from "./download-report.ts";
import { ScoutChart } from "./scout-chart.tsx";
import { useCancelReport, useReportDetail } from "./use-report-detail.ts";

const REMARK_PLUGINS = [remarkGfm];

// ── Citation model ────────────────────────────────────────────────────────
//
// Three citation kinds share one numbering + sources panel: facts (RAG
// corpus), Play Cricket matches, and Play Cricket player aggregate stats.
// They use different streaming part types but render through a single
// per-citation-key map so the inline chips and the sources panel agree on
// numbering. Keys identify a citation uniquely within a message:
//   fact          → f:<factId>
//   match         → m:<matchId>
//   player_stats  → p:<playerId>:<statType>
//
// `[[CITE:<key>]]` markers spliced into text parts get swapped for chips
// at render time. We keep the marker format permissive (any non-]
// characters between brackets) so future citation kinds with new key
// shapes don't need a regex change.

interface FactCitation {
  kind: "fact";
  factId: string;
  claim: string;
  content: string;
  tags: Record<string, string | string[]>;
  scope: "user" | "club";
  confidence: number;
}

interface MatchCitation {
  kind: "match";
  matchId: string;
  claim: string;
  matchDate?: string;
  homeTeam?: string;
  awayTeam?: string;
  groundName?: string;
  competition?: string;
  result?: string;
}

interface PlayerStatsCitation {
  kind: "player_stats";
  playerId: string;
  playerName?: string;
  statType: "batting" | "bowling" | "fielding";
  claim: string;
  season?: number;
  teamId?: string;
  gameType?: string;
  clubId?: string;
}

type Citation = FactCitation | MatchCitation | PlayerStatsCitation;

const PERCY_MAIN_HOSTNAME = "percymain.play-cricket.com";
const PERCY_MAIN_CLUB_ID = "134";

function citationKey(c: Citation): string {
  switch (c.kind) {
    case "fact":
      return `f:${c.factId}`;
    case "match":
      return `m:${c.matchId}`;
    case "player_stats":
      return `p:${c.playerId}:${c.statType}`;
  }
}

function citationDomId(c: Citation): string {
  return `cite-${citationKey(c).replace(/:/g, "-")}`;
}

function citationDomIdFromKey(key: string): string {
  return `cite-${key.replace(/:/g, "-")}`;
}

function buildPlayerStatsUrl(c: PlayerStatsCitation): string {
  const params = new URLSearchParams();
  params.set("club_id", c.clubId ?? PERCY_MAIN_CLUB_ID);
  params.set("tab", c.statType);
  if (c.teamId) params.set("team_id", c.teamId);
  if (c.gameType) params.set("game_type", c.gameType);
  return `https://${PERCY_MAIN_HOSTNAME}/player_stats/${c.statType}/${encodeURIComponent(c.playerId)}?${params.toString()}`;
}

function buildMatchUrl(c: MatchCitation): string {
  return `https://${PERCY_MAIN_HOSTNAME}/website/results/${encodeURIComponent(c.matchId)}`;
}

// ── Markdown component overrides ──────────────────────────────────────────

// Tailwind doesn't ship a typography plugin in this project, so we restyle
// the elements react-markdown emits ourselves. Tables get the heaviest
// treatment because Scout uses them constantly.
//
// Wrapped in a factory because the inline-element overrides (p, li, td)
// need access to the per-message numberByKey map so they can swap
// [[CITE:KEY]] markers for inline chips. Markers are spliced in by
// renderParts() before this is called.
function buildMarkdownComponents(
  numberByKey: Map<string, number>,
  onChipClick: (key: string) => void,
): Components {
  const cite = (children: React.ReactNode) =>
    numberByKey.size === 0
      ? children
      : injectCitations(children, numberByKey, onChipClick);
  return {
    table: ({ children, ...rest }) => (
      <div className="my-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm" {...rest}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...rest }) => (
      <thead className="border-b border-gray-300 bg-gray-50" {...rest}>
        {children}
      </thead>
    ),
    th: ({ children, ...rest }) => (
      <th
        className="border border-gray-200 px-2 py-1 text-left font-medium text-gray-700"
        {...rest}
      >
        {children}
      </th>
    ),
    td: ({ children, ...rest }) => (
      <td className="border border-gray-200 px-2 py-1 align-top" {...rest}>
        {cite(children)}
      </td>
    ),
    tr: ({ children, ...rest }) => (
      <tr className="even:bg-gray-50" {...rest}>
        {children}
      </tr>
    ),
    ul: ({ children, ...rest }) => (
      <ul className="my-2 list-disc pl-5" {...rest}>
        {children}
      </ul>
    ),
    ol: ({ children, ...rest }) => (
      <ol className="my-2 list-decimal pl-5" {...rest}>
        {children}
      </ol>
    ),
    li: ({ children, ...rest }) => (
      <li className="my-0.5" {...rest}>
        {cite(children)}
      </li>
    ),
    p: ({ children, ...rest }) => (
      <p className="my-2 first:mt-0 last:mb-0" {...rest}>
        {cite(children)}
      </p>
    ),
    h1: ({ children, ...rest }) => (
      <h1 className="my-2 text-base font-semibold" {...rest}>
        {children}
      </h1>
    ),
    h2: ({ children, ...rest }) => (
      <h2 className="my-2 text-sm font-semibold" {...rest}>
        {children}
      </h2>
    ),
    h3: ({ children, ...rest }) => (
      <h3 className="my-2 text-sm font-semibold" {...rest}>
        {children}
      </h3>
    ),
    code: ({ children, ...rest }) => (
      <code
        className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]"
        {...rest}
      >
        {children}
      </code>
    ),
    pre: ({ children, ...rest }) => (
      <pre
        className="my-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs"
        {...rest}
      >
        {children}
      </pre>
    ),
    a: ({ children, ...rest }) => (
      <a
        className="text-blue-700 underline hover:text-blue-900"
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
      >
        {children}
      </a>
    ),
  };
}

interface MessageViewProps {
  message: UIMessage;
  /** Submit a reply on the user's behalf — used by the inline question
   *  card (data-question parts) when the user picks an option or types a
   *  free-text answer. Optional so user-message renders don't need to
   *  pass it. */
  onAnswerQuestion?: (text: string) => void;
  /** Disables the question card while a stream is in flight, so old
   *  questions don't fire double answers. */
  isStreaming?: boolean;
}

interface QuestionData {
  question: string;
  options: Array<{ label: string; value: string }>;
  allowFreeText: boolean;
}

// ReportData is shared with the BE writer — see packages/shared/scout-report.
// Backend streams a placeholder snapshot immediately and re-emits the same
// id repeatedly as researcher / analyst / render phases advance, finishing
// with a status: "ready" (or "failed") snapshot. The FE renders whatever the
// latest snapshot says.
type ReportData = SharedReportData;

// Walk parts once to assign each unique citation key a stable number
// (1, 2, 3, ...). Numbers are scoped to a single message — citations don't
// carry across messages, since the sources panel is per-message.
function buildCitationIndex(parts: UIMessage["parts"]): {
  numberByKey: Map<string, number>;
  ordered: Citation[];
} {
  const numberByKey = new Map<string, number>();
  const ordered: Citation[] = [];
  for (const part of parts) {
    const c = partToCitation(part);
    if (!c) continue;
    const key = citationKey(c);
    if (numberByKey.has(key)) continue;
    numberByKey.set(key, ordered.length + 1);
    ordered.push(c);
  }
  return { numberByKey, ordered };
}

function partToCitation(part: UIMessage["parts"][number]): Citation | null {
  if (part.type === "data-fact-citation") {
    const data = (part as { data: Omit<FactCitation, "kind"> }).data;
    return { kind: "fact", ...data };
  }
  if (part.type === "data-match-citation") {
    const data = (part as { data: Omit<MatchCitation, "kind"> }).data;
    return { kind: "match", ...data };
  }
  if (part.type === "data-player-stats-citation") {
    const data = (part as { data: Omit<PlayerStatsCitation, "kind"> }).data;
    return { kind: "player_stats", ...data };
  }
  return null;
}

export function MessageView({
  message,
  onAnswerQuestion,
  isStreaming,
}: MessageViewProps) {
  const isUser = message.role === "user";
  const citations = isUser
    ? { numberByKey: new Map<string, number>(), ordered: [] as Citation[] }
    : buildCitationIndex(message.parts);

  // Track which source card is currently flashing. A click on an inline [N]
  // chip sets this to the citation key, scrolls the matching card into the
  // middle of the viewport, and we clear it after the animation completes
  // so the card returns to its resting state.
  const [flashingKey, setFlashingKey] = useState<string | null>(null);

  function handleChipClick(key: string) {
    const id = citationDomIdFromKey(key);
    const card = document.getElementById(id);
    if (card) {
      // block: 'center' is what the user asked for — scroll the card to
      // roughly the middle of the scroll container (the chat scroll
      // viewport is the nearest scrollable ancestor).
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Re-trigger the flash even if it was already flashing for this key by
    // clearing first on the next tick. Same-key clicks should re-pulse.
    setFlashingKey(null);
    requestAnimationFrame(() => setFlashingKey(key));
  }

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} my-3`}
      data-message-id={message.id}
      data-scout-message
    >
      <div
        className={`max-w-3xl rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-100 text-gray-900"
            : "w-full border border-gray-200 bg-white text-gray-900"
        }`}
      >
        {(() => {
          const rendered = renderParts(message.parts, citations.numberByKey);
          return rendered.map((part, i) => (
            <PartView
              key={`${message.id}-${i}`}
              part={part}
              numberByKey={citations.numberByKey}
              onChipClick={handleChipClick}
              onAnswerQuestion={onAnswerQuestion}
              isStreaming={isStreaming}
              isLast={i === rendered.length - 1}
            />
          ));
        })()}
        {!isUser && citations.ordered.length > 0 && (
          <SourcesPanel
            citations={citations.ordered}
            numberByKey={citations.numberByKey}
            flashingKey={flashingKey}
            onFlashEnd={() => setFlashingKey(null)}
          />
        )}
      </div>
    </div>
  );
}

type Part = UIMessage["parts"][number];

const CITE_MARKER_RE = /\[\[CITE:([^\]]+)\]\]/g;

/**
 * Fold each citation data part into the immediately preceding text part as
 * a `[[CITE:KEY]]` marker. The chip then renders inline (via the markdown
 * overrides) at the end of the cited sentence instead of as a sibling block
 * on a new line.
 *
 * Citation parts that don't follow a text part fall through unchanged and
 * render via the regular PartView path; the SourcesPanel reads the raw
 * parts array independently, so dropping citations from this rendered list
 * doesn't lose them from the bibliography.
 */
function renderParts(
  parts: UIMessage["parts"],
  numberByKey: Map<string, number>,
): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    // The citation tool calls have no UI of their own (the chip + source
    // card IS the UI). Drop them so the data-* citation that follows can
    // fold into the prose that preceded the tool call.
    if (
      part.type === "tool-cite_fact" ||
      part.type === "tool-cite_match" ||
      part.type === "tool-cite_player_stats" ||
      part.type === "tool-ask_question"
    ) {
      continue;
    }
    const citation = partToCitation(part);
    if (citation) {
      const key = citationKey(citation);
      if (!numberByKey.has(key)) continue;
      // Append marker to the most recent text part (skipping over any
      // non-text parts already in `out`, since the AI SDK puts the
      // tool-call in between the text and the citation data part).
      let target = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].type === "text") {
          target = i;
          break;
        }
      }
      if (target >= 0) {
        const t = out[target] as Part & { type: "text"; text: string };
        out[target] = {
          ...t,
          text: `${t.text}[[CITE:${key}]]`,
        } as Part;
        continue;
      }
      // No preceding text — fall through; PartView will render a standalone
      // chip as a fallback so the citation isn't lost.
      out.push(part);
      continue;
    }
    out.push(part);
  }
  return out;
}

interface CitationChipProps {
  citationKey: string;
  number: number;
  onClick: (key: string) => void;
}

function CitationChip({ citationKey, number, onClick }: CitationChipProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick(citationKey);
      }}
      className="ml-0.5 inline-flex cursor-pointer items-baseline rounded bg-blue-100 px-1 align-super text-[10px] font-semibold text-blue-700 hover:bg-blue-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
      title="View source"
    >
      [{number}]
    </button>
  );
}

/**
 * Walk the children of a markdown element (typically a `<p>`), scan each
 * string child for `[[CITE:KEY]]` markers, and splice in inline citation
 * chips at marker positions. Non-string children (already rendered React
 * nodes — `<strong>`, `<em>`, etc.) pass through unchanged.
 */
function injectCitations(
  children: React.ReactNode,
  numberByKey: Map<string, number>,
  onChipClick: (key: string) => void,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    if (!CITE_MARKER_RE.test(child)) return child;
    CITE_MARKER_RE.lastIndex = 0;
    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = CITE_MARKER_RE.exec(child)) !== null) {
      if (match.index > lastIdx) {
        segments.push(child.slice(lastIdx, match.index));
      }
      const key = match[1];
      const number = numberByKey.get(key);
      if (number) {
        segments.push(
          <CitationChip
            key={`cite-${match.index}-${key}`}
            citationKey={key}
            number={number}
            onClick={onChipClick}
          />,
        );
      }
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < child.length) segments.push(child.slice(lastIdx));
    return <>{segments}</>;
  });
}

function PartView({
  part,
  numberByKey,
  onChipClick,
  onAnswerQuestion,
  isStreaming,
  isLast,
}: {
  part: Part;
  numberByKey: Map<string, number>;
  onChipClick: (key: string) => void;
  onAnswerQuestion?: (text: string) => void;
  isStreaming?: boolean;
  isLast?: boolean;
}) {
  if (part.type === "text") {
    return (
      <div className="text-sm leading-relaxed text-gray-900">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={buildMarkdownComponents(numberByKey, onChipClick)}
        >
          {part.text}
        </ReactMarkdown>
      </div>
    );
  }

  if (part.type === "reasoning") {
    // Active = the model is still streaming AND this is the trailing part of
    // the message. Once any other part lands after it (text, tool, etc.) the
    // bubble collapses to a "Thought for Xs" pill so the prose isn't pushed
    // way down the page.
    return (
      <ThoughtBubble text={part.text} active={!!isStreaming && !!isLast} />
    );
  }

  if (part.type === "data-chart") {
    // Charts arrive as data-* parts via the AI SDK's UIMessageStream writer.
    // The schema is validated server-side (Zod) so the FE trusts the shape.
    const chartPart = part as { type: "data-chart"; data: ChartSpec };
    return <ScoutChart spec={chartPart.data} />;
  }

  if (part.type === "data-question") {
    const qPart = part as { type: "data-question"; data: QuestionData };
    return (
      <QuestionCard
        data={qPart.data}
        onAnswer={onAnswerQuestion}
        disabled={isStreaming}
      />
    );
  }

  if (part.type === "data-report") {
    const rPart = part as { type: "data-report"; data: ReportData };
    return <ReportCard data={rPart.data} />;
  }

  // Citation data parts that didn't get folded into a preceding text part
  // (rare — only when the model cites before any prose). Render a standalone
  // chip so the citation isn't lost.
  const citation = partToCitation(part);
  if (citation) {
    const key = citationKey(citation);
    const number = numberByKey.get(key);
    if (!number) return null;
    return (
      <CitationChip citationKey={key} number={number} onClick={onChipClick} />
    );
  }

  if (part.type.startsWith("tool-")) {
    // Citation tool calls render as the inline [N] chip + the Sources card,
    // not the generic tool-call box. generate_report is the same — the
    // data-report card IS its UI; the tool-call payload is just noise.
    if (
      part.type === "tool-cite_fact" ||
      part.type === "tool-cite_match" ||
      part.type === "tool-cite_player_stats" ||
      part.type === "tool-ask_question" ||
      // generate_report's UI is the data-report pipeline card. The tool-call
      // payload is just routing — never render it. The data-report part is
      // emitted as the very first thing inside execute(), so there's no gap.
      part.type === "tool-generate_report"
    ) {
      return null;
    }
    // ask_db gets a dedicated card that handles both the in-progress state
    // (rotating stages + shimmer) and the settled state (small blue pill with
    // a database icon, click to expand the input/output JSON) — matches the
    // ThoughtBubble's two-state pattern so the chat reads consistently.
    if (part.type === "tool-ask_db") {
      return <AskDbCard part={part} />;
    }
    return <ToolPartView part={part} />;
  }

  if (part.type === "step-start") return null;
  return null;
}

// ── ThoughtBubble (reasoning parts) ───────────────────────────────────────
//
// Active state: expanded body, monospace, sweeping gradient shimmer over the
// text while the model is mid-thought. Headed by a thought-bubble icon and
// "Thinking…" label.
//
// Settled state: collapses to a small pill ("Thought for Xs · click to
// expand"). Click toggles the body open. Duration is measured client-side
// from first render to the moment `active` flips false — the BE doesn't
// emit timing for reasoning parts.
function ThoughtBubble({ text, active }: { text: string; active: boolean }) {
  // Earliest non-empty render is "thinking started". A reasoning part can
  // render empty for a tick before the first chunk lands, so we wait for
  // text.length > 0 to set the timestamp. Render body stays pure — the ref
  // is set from a commit-phase effect to satisfy react-hooks/purity.
  const startRef = useRef<number | null>(null);
  const hasText = text.length > 0;
  useEffect(() => {
    if (hasText && startRef.current === null) {
      startRef.current = Date.now();
    }
  }, [hasText]);

  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // Freeze elapsed when the bubble settles — flipping `active` false marks
  // the end of the reasoning span. We don't update further so the pill stays
  // stable across re-renders.
  useEffect(() => {
    if (!active && startRef.current != null && elapsedSec === null) {
      setElapsedSec(
        Math.max(1, Math.round((Date.now() - startRef.current) / 1000)),
      );
    }
  }, [active, elapsedSec]);

  if (active) {
    return (
      <div className="my-2 rounded border border-purple-200 bg-purple-50/50 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-purple-700">
          <ThoughtIcon className="h-3.5 w-3.5" />
          <span>Thinking…</span>
        </div>
        <div
          className="animate-thought-shimmer bg-clip-text font-mono text-xs whitespace-pre-wrap text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(90deg, #6b21a8 0%, #6b21a8 35%, #c084fc 50%, #6b21a8 65%, #6b21a8 100%)",
            backgroundSize: "200% 100%",
          }}
        >
          {text || " "}
        </div>
      </div>
    );
  }

  // Settled: pill with optional expand.
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        <ThoughtIcon className="h-3 w-3" />
        <span>
          {elapsedSec != null ? `Thought for ${elapsedSec}s` : "Thought"}
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs whitespace-pre-wrap text-gray-600">
          {text}
        </div>
      )}
    </div>
  );
}

function ThoughtIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11a4 4 0 1 1 4 4H8a4 4 0 0 1 0-8 4 4 0 0 1 4-3 4 4 0 0 1 4 4" />
      <circle cx="6" cy="19" r="1.5" />
      <circle cx="3" cy="22" r="1" />
    </svg>
  );
}

// ── Sources panel + cards ─────────────────────────────────────────────────

interface SourcesPanelProps {
  citations: Citation[];
  numberByKey: Map<string, number>;
  flashingKey: string | null;
  onFlashEnd: () => void;
}

function SourcesPanel({
  citations,
  numberByKey,
  flashingKey,
  onFlashEnd,
}: SourcesPanelProps) {
  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="mb-2 text-xs font-semibold tracking-wide text-gray-600 uppercase">
        Sources
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {citations.map((c) => {
          const key = citationKey(c);
          const number = numberByKey.get(key) ?? 0;
          return (
            <SourceCard
              key={key}
              citation={c}
              number={number}
              flashing={flashingKey === key}
              onFlashEnd={onFlashEnd}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SourceCardProps {
  citation: Citation;
  number: number;
  flashing: boolean;
  onFlashEnd: () => void;
}

function SourceCard({
  citation,
  number,
  flashing,
  onFlashEnd,
}: SourceCardProps) {
  const baseClass =
    "relative rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-sm transition-colors";
  // animate-cite-flash is registered in app.css's @theme block. We toggle it
  // by adding the class only when this card is the flashing target; the
  // animationend handler clears the parent state so the class drops off.
  const flashClass = flashing ? "animate-cite-flash" : "";

  return (
    <div
      id={citationDomId(citation)}
      data-cite-key={citationKey(citation)}
      className={`${baseClass} ${flashClass}`}
      onAnimationEnd={() => {
        if (flashing) onFlashEnd();
      }}
    >
      <div className="absolute -top-2 -left-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white shadow">
        {number}
      </div>
      {citation.kind === "fact" && <FactCardBody citation={citation} />}
      {citation.kind === "match" && <MatchCardBody citation={citation} />}
      {citation.kind === "player_stats" && (
        <PlayerStatsCardBody citation={citation} />
      )}
    </div>
  );
}

function FactCardBody({ citation: c }: { citation: FactCitation }) {
  const tagPairs = Object.entries(c.tags)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" / ") : v}`)
    .join(" · ");
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Pill tone="green">Fact</Pill>
        <span className="text-[10px] text-gray-500">
          {c.scope === "user" ? "personal" : "club"} · confidence {c.confidence}
          /5
        </span>
      </div>
      <div className="font-medium text-gray-900">{c.content}</div>
      {tagPairs && (
        <div className="mt-1 text-[10px] text-gray-500">{tagPairs}</div>
      )}
    </div>
  );
}

function MatchCardBody({ citation: c }: { citation: MatchCitation }) {
  const teams =
    c.homeTeam && c.awayTeam
      ? `${c.homeTeam} v ${c.awayTeam}`
      : (c.homeTeam ?? c.awayTeam ?? `Match ${c.matchId}`);
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Pill tone="blue">Match</Pill>
        {c.matchDate && (
          <span className="text-[10px] text-gray-500">{c.matchDate}</span>
        )}
      </div>
      <a
        href={buildMatchUrl(c)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-900 hover:text-blue-700 hover:underline"
      >
        {teams}
      </a>
      {c.competition && (
        <div className="mt-0.5 text-[10px] text-gray-500">{c.competition}</div>
      )}
      {c.groundName && (
        <div className="text-[10px] text-gray-500">{c.groundName}</div>
      )}
      {c.result && (
        <div className="mt-1 text-[11px] font-medium text-gray-700">
          {c.result}
        </div>
      )}
      <div className="mt-1 truncate text-[10px] text-blue-700">
        play-cricket.com →
      </div>
    </div>
  );
}

function PlayerStatsCardBody({
  citation: c,
}: {
  citation: PlayerStatsCitation;
}) {
  const label = c.playerName ?? `Player ${c.playerId}`;
  const filters = [
    c.season ? String(c.season) : null,
    c.gameType ?? null,
    c.teamId ? `Team ${c.teamId}` : null,
  ].filter(Boolean) as string[];
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Pill tone="purple">{capitalise(c.statType)} stats</Pill>
        {c.season && (
          <span className="text-[10px] text-gray-500">{c.season}</span>
        )}
      </div>
      <a
        href={buildPlayerStatsUrl(c)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-900 hover:text-blue-700 hover:underline"
      >
        {label}
      </a>
      {filters.length > 0 && (
        <div className="mt-0.5 text-[10px] text-gray-500">
          {filters.join(" · ")}
        </div>
      )}
      <div className="mt-1 truncate text-[10px] text-blue-700">
        play-cricket.com →
      </div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "green" | "blue" | "purple";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "green"
      ? "bg-green-100 text-green-800"
      : tone === "blue"
        ? "bg-blue-100 text-blue-800"
        : "bg-purple-100 text-purple-800";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${toneClass}`}
    >
      {children}
    </span>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ── Inline question card (data-question) ─────────────────────────────────

function QuestionCard({
  data,
  onAnswer,
  disabled,
}: {
  data: QuestionData;
  onAnswer?: (text: string) => void;
  disabled?: boolean;
}) {
  // Lock the card once the user has answered, so a re-render driven by
  // streaming a later message doesn't let them click twice.
  const [answered, setAnswered] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");

  const submit = (text: string) => {
    if (!onAnswer || disabled || answered !== null) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setAnswered(trimmed);
    onAnswer(trimmed);
  };

  const isInteractive =
    onAnswer !== undefined && !disabled && answered === null;

  return (
    <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="text-sm font-medium text-amber-900">{data.question}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {data.options.map((opt) => {
          const picked = answered === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => submit(opt.value)}
              disabled={!isInteractive}
              className={
                picked
                  ? "rounded border border-amber-500 bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900"
                  : "rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-amber-300 disabled:hover:bg-white"
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {data.allowFreeText && answered === null && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit(freeText);
            setFreeText("");
          }}
        >
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            disabled={!isInteractive}
            placeholder="Or type an answer"
            className="flex-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!isInteractive || !freeText.trim()}
            className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}

// ── ask_db card (in-progress + settled) ──────────────────────────────────
//
// Sub-agent's tool loop typically takes 5–15 seconds (schema lookup → draft
// SQL → run → maybe retry → summarise). The generic tool-card just shows
// "·  ask_db ▸" for that whole window which feels dead.
//
// In-progress: rotating stage labels with the same shimmer effect the
// ThoughtBubble uses. The labels are plausible-but-not-claimed — we don't
// inspect the sub-agent's actual current step, we just keep the UI alive.
//
// Settled: collapses to a small blue pill ("Database query · Xs", or
// "Database query failed" on error), matching the ThoughtBubble's settled
// pill so the chat reads consistently. Click expands the input/output JSON
// for inspection.
const ASK_DB_STAGES = [
  "Inspecting schema…",
  "Drafting SQL query…",
  "Running query…",
  "Reading rows…",
  "Summarising results…",
];

function AskDbCard({ part }: { part: Part }) {
  const tool = part as unknown as ToolPart;
  const isDone =
    tool.state === "output-available" || tool.state === "output-error";
  const isError = tool.state === "output-error";

  const startRef = useRef<number | null>(null);
  useEffect(() => {
    startRef.current ??= Date.now();
  }, []);

  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  useEffect(() => {
    if (isDone && startRef.current != null && elapsedSec === null) {
      setElapsedSec(
        Math.max(1, Math.round((Date.now() - startRef.current) / 1000)),
      );
    }
  }, [isDone, elapsedSec]);

  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (isDone) return undefined;
    const id = setInterval(() => {
      setStageIdx((i) => (i + 1) % ASK_DB_STAGES.length);
    }, 1600);
    return () => clearInterval(id);
  }, [isDone]);

  const [open, setOpen] = useState(false);

  if (!isDone) {
    return (
      <div className="my-2 rounded border border-blue-200 bg-blue-50/50 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <DatabaseIcon className="h-3.5 w-3.5" />
          <span>Database query</span>
        </div>
        <div
          className="animate-thought-shimmer bg-clip-text font-mono text-xs text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(90deg, #1e40af 0%, #1e40af 35%, #93c5fd 50%, #1e40af 65%, #1e40af 100%)",
            backgroundSize: "200% 100%",
          }}
        >
          {ASK_DB_STAGES[stageIdx]}
        </div>
      </div>
    );
  }

  const pillClass = isError
    ? "inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100"
    : "inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100";

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={pillClass}
      >
        <DatabaseIcon className="h-3 w-3" />
        <span>
          {isError ? "Database query failed" : "Database query"}
          {!isError && elapsedSec != null ? ` · ${elapsedSec}s` : ""}
        </span>
        <span className={isError ? "text-red-400" : "text-blue-400"}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded border border-blue-200 bg-blue-50/30 p-2 text-xs">
          {tool.input !== undefined && (
            <details open>
              <summary className="cursor-pointer text-blue-700">
                question
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-1 font-mono text-[11px]">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </details>
          )}
          {tool.errorText && (
            <div className="mt-1 rounded bg-red-50 p-1 text-red-700">
              {tool.errorText}
            </div>
          )}
          {tool.output !== undefined && (
            <details>
              <summary className="cursor-pointer text-blue-700">result</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-1 font-mono text-[11px]">
                {JSON.stringify(tool.output, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
    </svg>
  );
}

// ── Tool-call card (debug view for non-citation tools) ────────────────────

interface ToolPart {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolPartView({ part }: { part: Part }) {
  const tool = part as unknown as ToolPart;
  const [open, setOpen] = useState(false);
  const toolName = tool.type.replace(/^tool-/, "");

  const stateLabel =
    tool.state === "output-available"
      ? "✓"
      : tool.state === "output-error"
        ? "✗"
        : tool.state === "input-streaming" || tool.state === "input-available"
          ? "…"
          : "·";

  return (
    <div
      data-scout-tool-card
      className="my-2 rounded border border-gray-200 bg-gray-50 text-xs"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-2 py-1 text-left font-mono text-gray-700 hover:bg-gray-100"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span className="mr-1 text-gray-400">{stateLabel}</span>
          {toolName}
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-200 px-2 py-1">
          {tool.input !== undefined && (
            <details open>
              <summary className="cursor-pointer text-gray-500">input</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-1 font-mono text-[11px]">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </details>
          )}
          {tool.errorText && (
            <div className="mt-1 rounded bg-red-50 p-1 text-red-700">
              {tool.errorText}
            </div>
          )}
          {tool.output !== undefined && (
            <details>
              <summary className="cursor-pointer text-gray-500">output</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-1 font-mono text-[11px]">
                {JSON.stringify(tool.output, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Report data-report card ─────────────────────────────────────────────────
//
// Three rendering modes driven off data.status:
//   - generating: ReportPipelineCard — three sequenced phase boxes with
//     fly-out tool-call chips, pulsing arrow into the active phase, and a
//     countdown to the configured budget for the active phase.
//   - ready: ReportReadyCard — compact timing strip ("✓ 47 records · ✓ 12
//     claims · ✓ 184 KB") above the download CTA.
//   - failed: ReportFailedCard — pipeline view (so the user sees which phase
//     broke) plus the error message.
//
// All three accept the same SharedReportData payload from the BE; the
// pipeline subcomponents are reused across generating/failed.

// Wall-clock budgets used by the FE to render the active-phase countdown.
// Sourced from REPORT_PHASE_BUDGETS_MS in @percy-main/shared so they match
// the BE's hard timeouts (SCOUT_RESEARCHER_TIMEOUT_MS, SCOUT_ANALYST_TIMEOUT_MS)
// — countdown never shows "over budget" while the BE still has headroom.
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

function ReportCard({ data }: { data: ReportData }) {
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
      {/* Tool-call chips: absolutely positioned above the box so they don't
          push layout. Active phase only renders chips; non-active phases
          may briefly hold stale ones from before the transition — those are
          dropped by the (Date.now - at) guard inside ToolChipFly. */}
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
  // Tick once a second so the countdown decreases live. The interval is
  // cheap; the only mounted ActiveCountdown at a time is the active phase.
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
  // Drop stale events the FE has already rendered before — chip-fly is 2.5s
  // so anything older than 3s has finished animating and shouldn't keep
  // remounting on rerender. Newest at the bottom (closest to the phase box),
  // floating up.
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
      {/* Right arrow at sm+, down arrow on mobile (vertical stack). */}
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
  // Round up so we don't show "0s remaining" while still ticking.
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
