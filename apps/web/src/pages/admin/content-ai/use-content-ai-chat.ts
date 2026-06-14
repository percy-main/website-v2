import { API_BASE } from "@/lib/api-client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

/**
 * Chat hook for the AI content-author modal. Ephemeral: there is no thread id
 * and no persistence - useChat holds the conversation while the modal is
 * mounted and discards it on close. The per-turn editorContext is passed via
 * sendMessage's `body` option by the modal, so it stays fresh as the draft
 * changes. Same transport wiring as Scout's use-scout-chat.
 */
export function useContentAiChat() {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE.replace(/\/api$/, "")}/api/content-author/messages`,
        credentials: "include",
      }),
    [],
  );

  return useChat({ transport });
}
