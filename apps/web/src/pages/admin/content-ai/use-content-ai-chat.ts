import { API_BASE } from "@/lib/api-client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DataUIPart, type UIDataTypes } from "ai";
import { useMemo } from "react";

/**
 * Chat hook for the AI content-author panel. Ephemeral: there is no thread id
 * and no persistence - useChat holds the conversation while the panel is
 * mounted (the whole time the editor is open; the sidebar tab hides rather
 * than unmounts it) and discards it when the editor closes. The per-turn
 * editorContext is passed via sendMessage's `body` option by the panel, so it
 * stays fresh as the draft changes. Same transport wiring as Scout's
 * use-scout-chat.
 */
export function useContentAiChat(options?: {
  /** Fires once per streamed data part (data-content-blocks / data-content-ops)
   *  as it arrives - the panel applies them to the editor from here. */
  onData?: (dataPart: DataUIPart<UIDataTypes>) => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE.replace(/\/api$/, "")}/api/content-author/messages`,
        credentials: "include",
      }),
    [],
  );

  return useChat({ transport, onData: options?.onData });
}
