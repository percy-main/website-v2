import { API_BASE } from "@/lib/api-client";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

export interface UseScoutChatOptions {
  threadId: string;
  initialMessages: UIMessage[];
}

export function useScoutChat({
  threadId,
  initialMessages,
}: UseScoutChatOptions) {
  // Memoise the transport so React doesn't tear it down between renders —
  // useChat treats a new transport identity as a new chat session.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE.replace(/\/api$/, "")}/api/scout/threads/${threadId}/messages`,
        credentials: "include",
      }),
    [threadId],
  );

  return useChat({
    id: threadId,
    messages: initialMessages,
    transport,
  });
}
