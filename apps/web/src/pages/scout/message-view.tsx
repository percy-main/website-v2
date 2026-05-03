import type { UIMessage } from "@ai-sdk/react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

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
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown>{part.text}</ReactMarkdown>
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
