import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function Composer({
  initialDraft = "",
  onDraftChange,
  onSubmit,
  disabled,
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
        <Button type="submit" disabled={Boolean(disabled) || !value.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}
