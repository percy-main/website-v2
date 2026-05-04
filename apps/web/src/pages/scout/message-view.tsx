import type { UIMessage } from "@ai-sdk/react";
import type { ChartSpec } from "@percy-main/shared";
import React, { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScoutChart } from "./scout-chart.tsx";

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
      className={`group flex ${isUser ? "justify-end" : "justify-start"} my-3`}
      data-message-id={message.id}
      data-scout-message
    >
      <div
        className={`max-w-3xl rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-100 text-gray-900"
            : "border border-gray-200 bg-white text-gray-900"
        }`}
      >
        {renderParts(message.parts, citations.numberByKey).map((part, i) => (
          <PartView
            key={`${message.id}-${i}`}
            part={part}
            numberByKey={citations.numberByKey}
            onChipClick={handleChipClick}
            onAnswerQuestion={onAnswerQuestion}
            isStreaming={isStreaming}
          />
        ))}
        {!isUser && citations.ordered.length > 0 && (
          <SourcesPanel
            citations={citations.ordered}
            numberByKey={citations.numberByKey}
            flashingKey={flashingKey}
            onFlashEnd={() => setFlashingKey(null)}
          />
        )}
        {!isUser && (
          <div className="mt-2 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 print:hidden">
            <ExportMessageButton messageId={message.id} />
          </div>
        )}
      </div>
    </div>
  );
}

// Triggers the browser's Print → Save as PDF flow, scoped to a single
// assistant message. The print stylesheet (in app.css) hides everything
// except the message marked data-scout-printing.
function ExportMessageButton({ messageId }: { messageId: string }) {
  function handleExport() {
    const target = document.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!(target instanceof HTMLElement)) return;
    target.setAttribute("data-scout-printing", "");
    const cleanup = () => {
      target.removeAttribute("data-scout-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
      title="Save this message as PDF"
    >
      Export
    </button>
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
}: {
  part: Part;
  numberByKey: Map<string, number>;
  onChipClick: (key: string) => void;
  onAnswerQuestion?: (text: string) => void;
  isStreaming?: boolean;
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
    return (
      <details className="my-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
        <summary className="cursor-pointer">reasoning</summary>
        <div className="mt-1 font-mono whitespace-pre-wrap">{part.text}</div>
      </details>
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
    // not the generic tool-call box.
    if (
      part.type === "tool-cite_fact" ||
      part.type === "tool-cite_match" ||
      part.type === "tool-cite_player_stats" ||
      part.type === "tool-ask_question"
    ) {
      return null;
    }
    return <ToolPartView part={part} />;
  }

  if (part.type === "step-start") return null;
  return null;
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
