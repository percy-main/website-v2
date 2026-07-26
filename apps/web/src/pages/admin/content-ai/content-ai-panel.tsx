import { Button } from "@/components/ui/button";
import { type UIMessage } from "@ai-sdk/react";
import {
  type DraftBlocks,
  type ResolvedBlock,
  type ResolvedEditOp,
} from "@percy-main/shared/content";
import { useEffect, useRef, useState } from "react";
import { useContentAiChat } from "./use-content-ai-chat.js";

export interface ContentAiEditorContext {
  kind: string;
  title: string;
  slug?: string;
  metadata: Record<string, unknown>;
  /** Plain-text projection of the live draft (ids included) so the agent can
   *  see and edit existing content. */
  blocks: DraftBlocks;
}

interface ContentAiPanelProps {
  /** Built fresh on each send so the agent sees the current draft + metadata. */
  getEditorContext: () => ContentAiEditorContext;
  /** Append agent-authored blocks to the live editor (parent owns the editor). */
  onInsertBlocks: (blocks: ResolvedBlock[]) => void;
  /** Apply agent edit ops to the live editor (parent owns the editor).
   *  Returns false when the whole batch was dropped because the draft
   *  changed underneath it (stale block ids) - the panel flags that chip. */
  onApplyOps: (ops: ResolvedEditOp[]) => boolean;
}

/**
 * The "Assistant" sidebar panel over the content editor. A lean chat: the
 * agent researches club data, appends finished blocks via write_content and
 * edits the draft in place via edit_content. The panel stays mounted while
 * the editor is open (the sidebar tab hides, never unmounts it), so the
 * conversation survives tab switches; it resets when the editor closes.
 */
export function ContentAiPanel({
  getEditorContext,
  onInsertBlocks,
  onApplyOps,
}: ContentAiPanelProps) {
  const [value, setValue] = useState("");
  // Edit-op parts whose whole batch was dropped because the draft changed
  // underneath them - their chips render as a warning instead of a success.
  const [skippedPartKeys, setSkippedPartKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Belt-and-braces dedupe: onData should fire once per part, but applying a
  // block twice would corrupt the draft, so guard on the part id anyway.
  // Use a ref for mutable dedupe state that persists across renders without
  // triggering re-renders.
  const seenPartIds = useRef(new Set<string>());

  // Data parts apply to the editor as they stream in, in arrival order (one
  // handler covers both types so appends and edits stay ordered relative to
  // each other). Both part types always carry a server-assigned id.
  const { messages, sendMessage, status, error, stop } = useContentAiChat({
    onData: (dataPart) => {
      if (
        dataPart.type !== "data-content-blocks" &&
        dataPart.type !== "data-content-ops"
      ) {
        return;
      }
      const key = dataPart.id;
      if (!key || seenPartIds.current.has(key)) return;
      seenPartIds.current.add(key);
      if (dataPart.type === "data-content-blocks") {
        const { blocks } = dataPart.data as { blocks?: ResolvedBlock[] };
        if (blocks && blocks.length > 0) onInsertBlocks(blocks);
      } else {
        const { ops } = dataPart.data as { ops?: ResolvedEditOp[] };
        if (ops && ops.length > 0 && !onApplyOps(ops)) {
          setSkippedPartKeys((prev) => new Set(prev).add(key));
        }
      }
    },
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as content streams in.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    void sendMessage(
      { text: trimmed },
      { body: { editorContext: getEditorContext() } },
    );
    setValue("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && <EmptyState />}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            skippedPartKeys={skippedPartKeys}
          />
        ))}
        {isStreaming && (
          <p className="text-xs text-stone-400">The assistant is working…</p>
        )}
        {status === "error" && (
          <p className="text-sm text-red-600">
            {error?.message ?? "Something went wrong. Please try again."}
          </p>
        )}
      </div>

      <form
        className="mt-2 flex items-end gap-2 border-t border-stone-200 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Write a match report for this game (Cmd/Ctrl+Enter to send)"
          rows={2}
          disabled={isStreaming}
          className="min-w-0 flex-1 resize-y rounded border border-stone-300 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-stone-50"
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void stop()}
          >
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!value.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500">
      <p>
        Describe what you'd like and the assistant will research the club's
        data, then write straight into your draft - it can add new content and
        edit what's already there.
      </p>
      <p className="mt-2 font-medium text-stone-700">Try asking for:</p>
      <ul className="mt-1 list-disc pl-5">
        <li>"Write a match report for this game"</li>
        <li>"Rewrite the intro to mention the weather"</li>
        <li>"Add a league table and our current batting leaderboard"</li>
      </ul>
    </div>
  );
}

function MessageBubble({
  message,
  skippedPartKeys,
}: {
  message: UIMessage;
  skippedPartKeys: ReadonlySet<string>;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm " +
          (isUser ? "bg-blue-600 text-white" : "bg-stone-100 text-stone-800")
        }
      >
        {message.parts.map((part, index) => {
          // Data parts carry the server-assigned id the onData handler used,
          // so a dropped ops batch finds its own chip.
          const partId = (part as { id?: string }).id;
          return (
            <PartView
              key={`${message.id}-${index}-${part.type}`}
              part={part}
              skipped={partId !== undefined && skippedPartKeys.has(partId)}
            />
          );
        })}
      </div>
    </div>
  );
}

// Friendly labels for the tool-call status chips.
function toolLabel(toolType: string): string {
  const name = toolType.replace(/^tool-/, "");
  if (name === "write_content") return "Writing content";
  if (name === "edit_content") return "Editing content";
  if (name.startsWith("pc_")) return "Looking up Play-Cricket";
  if (name.startsWith("db_")) return "Reading the club database";
  if (name.startsWith("weather_")) return "Checking the weather";
  return name;
}

function PartView({
  part,
  skipped = false,
}: {
  part: UIMessage["parts"][number];
  /** True when this part's edit-op batch was dropped as stale. */
  skipped?: boolean;
}) {
  if (part.type === "text") {
    return <p className="whitespace-pre-wrap">{part.text}</p>;
  }

  if (part.type === "reasoning") {
    return (
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer select-none">Thinking…</summary>
        <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
      </details>
    );
  }

  if (part.type === "data-content-blocks") {
    const blocksPart = part as {
      type: "data-content-blocks";
      data: { blocks: ResolvedBlock[] };
    };
    const count = blocksPart.data.blocks.length;
    return (
      <p className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
        ✨ Added {count} block{count === 1 ? "" : "s"} to your draft
      </p>
    );
  }

  if (part.type === "data-content-ops") {
    const opsPart = part as {
      type: "data-content-ops";
      data: { ops: ResolvedEditOp[] };
    };
    const count = opsPart.data.ops.length;
    if (skipped) {
      return (
        <p className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
          ⚠ The draft changed while the assistant was editing - {count} change
          {count === 1 ? "" : "s"} skipped. Ask again if you still want them.
        </p>
      );
    }
    return (
      <p className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
        ✏️ Edited your draft - {count} change{count === 1 ? "" : "s"}
      </p>
    );
  }

  if (part.type.startsWith("tool-")) {
    const toolPart = part as {
      state?: string;
      errorText?: string;
      output?: { error?: string };
    };
    // A tool can fail two ways: the execute threw (state "output-error",
    // errorText set), or it returned an { error } payload (e.g. the db tools
    // and edit_content validation failures). Surface both - otherwise a
    // failed call looks identical to a successful one and there's nothing to
    // debug from.
    const errorText =
      toolPart.state === "output-error"
        ? (toolPart.errorText ?? "tool error")
        : toolPart.output?.error;
    if (errorText) {
      return (
        <p className="text-xs text-red-600">
          ⚠ {toolLabel(part.type)} failed: {errorText}
        </p>
      );
    }
    const done = toolPart.state === "output-available";
    return (
      <p className="text-xs text-stone-500">
        {done ? "✓" : "…"} {toolLabel(part.type)}
      </p>
    );
  }

  return null;
}
