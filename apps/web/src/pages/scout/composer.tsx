import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { AttachmentPreview } from "./attachments/attachment-preview.js";
import {
  ATTACHMENT_ACCEPT_ATTR,
  isAcceptedAttachment,
  type PendingAttachment,
} from "./attachments/use-attachment-upload.js";

export type ThinkingMode = "thinking" | "fast";

interface ComposerProps {
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  onSubmit: (text: string) => void;
  /** Abort the in-flight assistant turn. Wired from useChat's `stop`. */
  onStop: () => void;
  /** True while the assistant turn is submitting / streaming. Disables the
   *  textarea and thinking toggle, and switches the right-hand button from
   *  Send → Stop. */
  isStreaming?: boolean;
  /** Per-turn reasoning toggle. Controlled by the parent so it can survive
   *  thread switches and be sent on the next message body. */
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
  /** Per-turn attachment chips. Controlled by the parent so they reset
   *  on send and across thread switches. */
  attachments: PendingAttachment[];
  onUploadFile: (file: File) => void;
  onRemoveAttachment: (localId: string) => void;
  /** True while any chip is uploading or processing. Disables Send. */
  isUploadingAttachments: boolean;
}

export function Composer({
  initialDraft = "",
  onDraftChange,
  onSubmit,
  onStop,
  isStreaming,
  thinkingMode,
  onThinkingModeChange,
  attachments,
  onUploadFile,
  onRemoveAttachment,
  isUploadingAttachments,
}: ComposerProps) {
  const [value, setValue] = useState(() => initialDraft);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || isUploadingAttachments) return;
    onSubmit(trimmed);
    setValue("");
    onDraftChange?.("");
  };

  const handleFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (isAcceptedAttachment(file)) onUploadFile(file);
    }
  };

  return (
    <form
      className="border-t border-stone-200 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => {
        // Only react to drags carrying files.
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <AttachmentPreview
              key={a.localId}
              attachment={a}
              onRemove={onRemoveAttachment}
            />
          ))}
        </div>
      )}
      <div
        className={
          "flex items-end gap-2 rounded transition-colors " +
          (isDragging ? "bg-blue-50 ring-2 ring-blue-300 ring-offset-1" : "")
        }
      >
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
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            const accepted = files.filter(isAcceptedAttachment);
            if (accepted.length > 0) {
              e.preventDefault();
              handleFiles(accepted);
            }
          }}
          placeholder={
            isDragging
              ? "Drop image or PDF to attach"
              : "Ask Scout… (Cmd/Ctrl+Enter to send · paste or drop image/PDF)"
          }
          rows={3}
          disabled={isStreaming}
          className="flex-1 resize-y rounded border border-stone-300 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-stone-50"
        />
        <div className="flex flex-col gap-2">
          <ThinkingModeToggle
            mode={thinkingMode}
            onChange={onThinkingModeChange}
            disabled={isStreaming}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            title="Attach an image or PDF (max 10 MB)"
            className="inline-flex items-center justify-center gap-1.5 rounded border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
          >
            <PaperclipIcon className="size-3.5" />
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT_ATTR}
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              // Reset so picking the same file twice in a row still fires.
              e.target.value = "";
            }}
          />
          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onStop}
              title="Stop the in-flight turn. The partial assistant message stays in the thread."
            >
              <StopIcon className="mr-1 size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!value.trim() || isUploadingAttachments}
              title={
                isUploadingAttachments
                  ? "Wait for attachments to finish processing"
                  : undefined
              }
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
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
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.49-8.48a4 4 0 0 1 5.66 5.65l-8.49 8.49a2 2 0 1 1-2.83-2.83l7.07-7.07" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
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
          : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50")
      }
    >
      {isThinking ? (
        <ThoughtIcon className="size-3.5" />
      ) : (
        <BoltIcon className="size-3.5" />
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
