import type { UIMessage } from "@ai-sdk/react";
import type { ChartSpec } from "@percy-main/shared";
import React, { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScoutChart } from "./scout-chart.tsx";

const REMARK_PLUGINS = [remarkGfm];

// Tailwind doesn't ship a typography plugin in this project, so we restyle
// the elements react-markdown emits ourselves. Tables get the heaviest
// treatment because Scout uses them constantly.
//
// Wrapped in a factory because the inline-element overrides (p, li,
// table cells) need access to the per-message citationNumberByFactId
// map so they can swap [[CITE:UUID]] markers in their text children
// for inline citation chips. Markers are spliced in by renderParts()
// before this is called.
function buildMarkdownComponents(
  citationNumberByFactId: Map<string, number>,
): Components {
  const cite = (children: React.ReactNode) =>
    citationNumberByFactId.size === 0
      ? children
      : injectCitations(children, citationNumberByFactId);
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
      {children}
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
}

interface Citation {
  factId: string;
  claim: string;
  content: string;
  tags: Record<string, string | string[]>;
  scope: "user" | "club";
  confidence: number;
}

// Walk parts once to assign each unique factId a stable citation number
// (1, 2, 3, ...). Numbers are scoped to a single message — citations
// don't carry across messages, since the sources panel is per-message.
function buildCitationIndex(parts: UIMessage["parts"]): {
  numberByFactId: Map<string, number>;
  ordered: Citation[];
} {
  const numberByFactId = new Map<string, number>();
  const ordered: Citation[] = [];
  for (const part of parts) {
    if (part.type !== "data-fact-citation") continue;
    const data = (part as { data: Citation }).data;
    if (numberByFactId.has(data.factId)) continue;
    numberByFactId.set(data.factId, ordered.length + 1);
    ordered.push(data);
  }
  return { numberByFactId, ordered };
}

export function MessageView({ message }: MessageViewProps) {
  const isUser = message.role === "user";
  const citations = isUser
    ? { numberByFactId: new Map<string, number>(), ordered: [] as Citation[] }
    : buildCitationIndex(message.parts);

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
        {renderParts(message.parts, citations.numberByFactId).map(
          (part, i) => (
            <PartView
              key={`${message.id}-${i}`}
              part={part}
              citationNumberByFactId={citations.numberByFactId}
            />
          ),
        )}
        {!isUser && citations.ordered.length > 0 && (
          <SourcesPanel citations={citations.ordered} />
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
// assistant message. The print stylesheet (in scout.tsx) hides everything
// except the message marked data-scout-printing. We pick that target by
// message id at click time so unrelated messages stay hidden.
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

// Citation markers we splice into text-part content. Picked to be both
// markdown-safe (no syntax meaning) and unlikely to collide with prose.
const CITE_MARKER_RE = /\[\[CITE:([0-9a-f-]+)\]\]/gi;

/**
 * Fold each data-fact-citation part into the immediately preceding
 * text part as a `[[CITE:UUID]]` marker. The chip then renders inline
 * (via the `p` markdown override) at the end of the cited sentence
 * instead of as a sibling block on a new line.
 *
 * Citation parts that don't follow a text part fall through unchanged
 * and render via the regular PartView path; the SourcesPanel reads the
 * raw parts array independently, so dropping citations from this
 * rendered list doesn't lose them from the bibliography.
 */
function renderParts(
  parts: UIMessage["parts"],
  numberByFactId: Map<string, number>,
): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    // tool-cite_fact has no UI (the citation chip is the UI). Drop it
    // from the rendered list so the data-fact-citation that follows
    // can fold into the *text* part that preceded the tool call.
    if (part.type === "tool-cite_fact") continue;
    if (part.type === "data-fact-citation") {
      const data = (part as { data: { factId: string } }).data;
      if (!numberByFactId.has(data.factId)) continue;
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
          text: `${t.text}[[CITE:${data.factId}]]`,
        } as Part;
        continue;
      }
      // No preceding text — fall through; PartView will render it
      // standalone (rare; happens only if the model cites before any
      // prose).
      out.push(part);
      continue;
    }
    out.push(part);
  }
  return out;
}

interface CitationChipProps {
  factId: string;
  number: number;
}

function CitationChip({ factId, number }: CitationChipProps) {
  return (
    <a
      href={`#fact-${factId}`}
      className="ml-0.5 inline-flex items-baseline rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700 align-super hover:bg-blue-200"
      title="View source"
    >
      [{number}]
    </a>
  );
}

/**
 * Walk the children of a markdown element (typically a `<p>`), scan
 * each string child for `[[CITE:UUID]]` markers, and splice in inline
 * citation chips at marker positions. Non-string children (already
 * rendered React nodes — `<strong>`, `<em>`, etc.) pass through
 * unchanged.
 */
function injectCitations(
  children: React.ReactNode,
  numberByFactId: Map<string, number>,
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
      const factId = match[1];
      const number = numberByFactId.get(factId);
      if (number) {
        segments.push(
          <CitationChip
            key={`cite-${match.index}-${factId}`}
            factId={factId}
            number={number}
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
  citationNumberByFactId,
}: {
  part: Part;
  citationNumberByFactId: Map<string, number>;
}) {
  if (part.type === "text") {
    return (
      <div className="text-sm leading-relaxed text-gray-900">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={buildMarkdownComponents(citationNumberByFactId)}
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

  if (part.type === "data-fact-citation") {
    // Normal path: renderParts() folded this into the preceding text
    // part as a [[CITE:UUID]] marker, and the markdown override emits
    // the inline chip. We only get here when there was no preceding
    // text — render a standalone chip as a fallback so the citation
    // isn't lost.
    const data = (part as { data: { factId: string } }).data;
    const number = citationNumberByFactId.get(data.factId);
    if (!number) return null;
    return <CitationChip factId={data.factId} number={number} />;
  }

  if (part.type.startsWith("tool-")) {
    // cite_fact has its own inline rendering (the [N] chip + Sources
    // panel below). Hide the generic tool-call box for it — it adds
    // visual noise alongside the citation it produced.
    if (part.type === "tool-cite_fact") return null;
    return <ToolPartView part={part} />;
  }

  if (part.type === "step-start") return null;
  return null;
}

function SourcesPanel({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-700">
      <div className="mb-1 font-semibold text-gray-600">Sources</div>
      <ol className="list-decimal space-y-1 pl-5">
        {citations.map((c, idx) => {
          const tagPairs = Object.entries(c.tags)
            .map(
              ([k, v]) =>
                `${k}: ${Array.isArray(v) ? v.join(" / ") : v}`,
            )
            .join(" · ");
          return (
            <li key={c.factId} id={`fact-${c.factId}`} className="leading-snug">
              <span className="font-medium">{c.content}</span>
              <span className="ml-2 text-gray-500">
                {c.scope === "user" ? "personal" : "club"}
                {" · "}confidence {c.confidence}/5
                {tagPairs ? ` · ${tagPairs}` : ""}
              </span>
              {c.claim && idx === 0 ? null : null /* claim is captured per cite; not shown in panel to keep it compact */}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
