import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { UIMessage } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { Composer } from "./composer.js";
import { MessageView } from "./message-view.js";
import { ThreadList } from "./thread-list.js";
import { useScoutChat } from "./use-scout-chat.js";

export function Component() {
  useDocumentMeta("Scout");
  const { threadId } = useParams<{ threadId?: string }>();

  return (
    <div className="container mx-auto h-[calc(100vh-8rem)] px-0">
      <div className="flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ThreadList />
        <main className="flex flex-1 flex-col">
          {threadId ? <ActiveThread threadId={threadId} /> : <EmptyState />}
        </main>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center text-center text-sm text-gray-500">
      <div>
        <div className="mb-1 font-medium text-gray-700">
          Pick a thread, or start a new one.
        </div>
        <div>
          Scout helps you scout opposition and plan dismissals using Play
          Cricket data + our match history.
        </div>
      </div>
    </div>
  );
}

function ActiveThread({ threadId }: { threadId: string }) {
  const threadQuery = useQuery({
    queryKey: ["scout", "thread", threadId],
    queryFn: () =>
      callApi(
        api.GET("/api/scout/threads/{threadId}", {
          params: { path: { threadId } },
        }),
      ),
  });

  if (threadQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        Loading thread…
      </div>
    );
  }
  if (threadQuery.error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">
        {threadQuery.error instanceof Error
          ? threadQuery.error.message
          : "Failed to load thread"}
      </div>
    );
  }
  if (!threadQuery.data) return null;

  return <ChatView threadId={threadId} loaded={threadQuery.data} />;
}

interface ChatViewProps {
  threadId: string;
  loaded: {
    thread: { id: string; title: string };
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      parts: unknown[];
    }>;
    usage: { inputTokens: number; outputTokens: number };
  };
}

function ChatView({ threadId, loaded }: ChatViewProps) {
  const initialMessages = useMemo<UIMessage[]>(
    () =>
      loaded.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(
          (m) =>
            ({
              id: m.id,
              role: m.role,
              parts: m.parts,
            }) as unknown as UIMessage,
        ),
    [loaded.messages],
  );

  const { messages, sendMessage, status, error } = useScoutChat({
    threadId,
    initialMessages,
  });

  // Composer draft persisted in URL searchParams per project convention.
  const [searchParams, setSearchParams] = useSearchParams();
  const draft = searchParams.get("d") ?? "";
  const setDraft = (next: string) => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next) sp.set("d", next);
        else sp.delete("d");
        return sp;
      },
      { replace: true },
    );
  };

  // Auto-scroll to the bottom when new content arrives.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h2 className="truncate text-sm font-medium text-gray-700">
          {loaded.thread.title}
        </h2>
        <span className="text-xs text-gray-400">
          {messages.length} message{messages.length === 1 ? "" : "s"}
          {import.meta.env.DEV && (
            <>
              {" · "}
              {loaded.usage.inputTokens.toLocaleString()} in /{" "}
              {loaded.usage.outputTokens.toLocaleString()} out
            </>
          )}
        </span>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-gray-400">
            New thread. Ask a question to get started.
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
        {error && (
          <div className="my-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error.message}
          </div>
        )}
      </div>
      <Composer
        initialDraft={draft}
        onDraftChange={setDraft}
        disabled={isStreaming}
        onSubmit={(text) => {
          sendMessage({ text });
        }}
      />
    </>
  );
}
