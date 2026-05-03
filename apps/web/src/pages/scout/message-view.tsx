import type { UIMessage } from "@ai-sdk/react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

// Tailwind doesn't ship a typography plugin in this project, so we restyle
// the elements react-markdown emits ourselves. Tables get the heaviest
// treatment because Scout uses them constantly.
const markdownComponents: Components = {
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
      {children}
    </li>
  ),
  p: ({ children, ...rest }) => (
    <p className="my-2 first:mt-0 last:mb-0" {...rest}>
      {children}
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

interface MessageViewProps {
  message: UIMessage;
}

export function MessageView({ message }: MessageViewProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} my-3`}
      data-message-id={message.id}
    >
      <div
        className={`max-w-3xl rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-100 text-gray-900"
            : "border border-gray-200 bg-white text-gray-900"
        }`}
      >
        {message.parts.map((part, i) => (
          <PartView key={`${message.id}-${i}`} part={part} />
        ))}
      </div>
    </div>
  );
}

type Part = UIMessage["parts"][number];

function PartView({ part }: { part: Part }) {
  if (part.type === "text") {
    return (
      <div className="text-sm leading-relaxed text-gray-900">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={markdownComponents}
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

  if (part.type.startsWith("tool-")) {
    return <ToolPartView part={part} />;
  }

  if (part.type === "step-start") return null;
  return null;
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
    <div className="my-2 rounded border border-gray-200 bg-gray-50 text-xs">
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
