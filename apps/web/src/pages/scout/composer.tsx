import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

export type ThinkingMode = "thinking" | "fast";

interface ComposerProps {
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Per-turn reasoning toggle. Controlled by the parent so it can survive
   *  thread switches and be sent on the next message body. */
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}

export function Composer({
  initialDraft = "",
  onDraftChange,
  onSubmit,
  disabled,
  thinkingMode,
  onThinkingModeChange,
}: ComposerProps) {
  const [value, setValue] = useState(initialDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-sync when the controlling URL changes (e.g. switching threads).
  useEffect(() => {
    setValue(initialDraft);
  }, [initialDraft]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    onDraftChange?.("");
  };

  return (
    <form
      className="border-t border-gray-200 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onDraftChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask Scout… (Cmd/Ctrl+Enter to send)"
          rows={3}
          disabled={disabled}
          className="flex-1 resize-y rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        />
        <div className="flex flex-col gap-2">
          <ThinkingModeToggle
            mode={thinkingMode}
            onChange={onThinkingModeChange}
            disabled={disabled}
          />
          <Button type="submit" disabled={Boolean(disabled) || !value.trim()}>
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── Thinking-mode toggle ──────────────────────────────────────────────────
//
// Small two-state pill in the composer's button column. Click to flip
// between "Thinking" (chain-of-thought enabled — slower, better on multi-
// step queries) and "Fast" (thinking disabled — quicker, fine for
// follow-ups). Default is decided by the parent so it survives thread
// switches and the URL state. Only DeepSeek currently honours this on the
// BE; the toggle is harmless on Anthropic runs.
function ThinkingModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ThinkingMode;
  onChange: (next: ThinkingMode) => void;
  disabled?: boolean;
}) {
  const isThinking = mode === "thinking";
  return (
    <button
      type="button"
      disabled={Boolean(disabled)}
      onClick={() => onChange(isThinking ? "fast" : "thinking")}
      title={
        isThinking
          ? "Thinking mode: model reasons before answering. Click for Fast."
          : "Fast mode: skip reasoning for quick follow-ups. Click for Thinking."
      }
      className={
        "inline-flex items-center justify-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 " +
        (isThinking
          ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50")
      }
    >
      {isThinking ? (
        <ThoughtIcon className="h-3.5 w-3.5" />
      ) : (
        <BoltIcon className="h-3.5 w-3.5" />
      )}
      <span>{isThinking ? "Thinking" : "Fast"}</span>
    </button>
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

function BoltIcon({ className }: { className?: string }) {
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
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
