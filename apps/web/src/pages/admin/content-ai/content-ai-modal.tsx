import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type UIMessage } from "@ai-sdk/react";
import { type WriteContentBlock } from "@percy-main/shared/content";
import { useEffect, useRef, useState } from "react";
import { useContentAiChat } from "./use-content-ai-chat.js";

export interface ContentAiEditorContext {
  kind: string;
  title: string;
  slug?: string;
  metadata: Record<string, unknown>;
  existingBlockTypes?: string[];
}

interface ContentAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Built fresh on each send so the agent sees the current draft + metadata. */
  getEditorContext: () => ContentAiEditorContext;
  /** Append agent-authored blocks to the live editor (parent owns the editor). */
  onInsertBlocks: (blocks: WriteContentBlock[]) => void;
}

/**
 * "Generate with AI" modal over the content editor. A lean chat: the agent
 * researches club data and appends finished blocks to the draft via the
 * write_content tool. DialogContent unmounts when closed, so the chat state
 * resets on each open (the feature is intentionally ephemeral).
 */
export function ContentAiModal({
  open,
  onOpenChange,
  getEditorContext,
  onInsertBlocks,
}: ContentAiModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Generate with AI</DialogTitle>
          <DialogDescription>
            Describe what you'd like and the assistant will research the club's
            data and add content to your draft. It always writes in a positive,
            club-friendly tone.
          </DialogDescription>
        </DialogHeader>
        <ContentAiChat
          getEditorContext={getEditorContext}
          onInsertBlocks={onInsertBlocks}
        />
      </DialogContent>
    </Dialog>
  );
}

function ContentAiChat({
  getEditorContext,
  onInsertBlocks,
}: Pick<ContentAiModalProps, "getEditorContext" | "onInsertBlocks">) {
  const { messages, sendMessage, status, error, stop } = useContentAiChat();
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Append each data-content-blocks part exactly once. useChat re-renders
  // parts on every streamed token, so dedupe by the part's id.
  const seenBlockPartIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      message.parts.forEach((part, index) => {
        if (part.type !== "data-content-blocks") return;
        const blocksPart = part as {
          type: "data-content-blocks";
          id?: string;
          data: { blocks: WriteContentBlock[] };
        };
        const key = blocksPart.id ?? `${message.id}:${index}`;
        if (seenBlockPartIds.current.has(key)) return;
        seenBlockPartIds.current.add(key);
        if (blocksPart.data.blocks.length > 0) {
          onInsertBlocks(blocksPart.data.blocks);
        }
      });
    }
  }, [messages, onInsertBlocks]);

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
          <MessageBubble key={message.id} message={message} />
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
          className="flex-1 resize-y rounded border border-stone-300 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-stone-50"
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
      <p className="font-medium text-stone-700">Try asking for:</p>
      <ul className="mt-1 list-disc pl-5">
        <li>"Write a match report for this game"</li>
        <li>"Draft a friendly news post welcoming new members"</li>
        <li>"Add a league table and our current batting leaderboard"</li>
      </ul>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm " +
          (isUser ? "bg-blue-600 text-white" : "bg-stone-100 text-stone-800")
        }
      >
        {message.parts.map((part, index) => (
          <PartView key={`${message.id}-${index}-${part.type}`} part={part} />
        ))}
      </div>
    </div>
  );
}

// Friendly labels for the tool-call status chips.
function toolLabel(toolType: string): string {
  const name = toolType.replace(/^tool-/, "");
  if (name === "write_content") return "Writing content";
  if (name.startsWith("pc_")) return "Looking up Play-Cricket";
  if (name.startsWith("db_")) return "Reading the club database";
  if (name.startsWith("weather_")) return "Checking the weather";
  return name;
}

function PartView({ part }: { part: UIMessage["parts"][number] }) {
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
      data: { blocks: WriteContentBlock[] };
    };
    const count = blocksPart.data.blocks.length;
    return (
      <p className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
        ✨ Added {count} block{count === 1 ? "" : "s"} to your draft
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
    // errorText set), or it returned an { error } payload (e.g. the db tools).
    // Surface both - otherwise a failed DB call looks identical to a successful
    // one and there's nothing to debug from.
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
