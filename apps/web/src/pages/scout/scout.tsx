import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { UIMessage } from "@ai-sdk/react";
import type { ReportData } from "@percy-main/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { MessageAttachments } from "./attachments/message-attachments.js";
import { useAttachmentUpload } from "./attachments/use-attachment-upload.js";
import { Composer, type ThinkingMode } from "./composer.js";
import { DebriefLauncher } from "./debrief-launcher.js";
import { MessageView } from "./message-view.js";
import { ReportsView } from "./reports-view.js";
import { ScoutLauncher } from "./scout-launcher.js";
import { ThreadList } from "./thread-list.js";
import { useScoutChat } from "./use-scout-chat.js";

type ScoutMode = "chat" | "debrief" | "scout";

export function Component() {
  useDocumentMeta("Scout");
  const { threadId } = useParams<{ threadId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL-state per the project's URL-state convention. The reports tab is
  // global (not per-thread) so it survives switching between threads.
  const view = searchParams.get("view") === "reports" ? "reports" : "chat";

  const setView = (next: "chat" | "reports") => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next === "reports") sp.set("view", "reports");
        else sp.delete("view");
        return sp;
      },
      { replace: true },
    );
  };

  return (
    <div className="container mx-auto h-[calc(100vh-8rem)] px-0">
      <div className="flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ThreadList />
        <main className="flex flex-1 flex-col">
          <ScoutTabs view={view} setView={setView} />
          {view === "reports" ? (
            <ReportsView />
          ) : threadId ? (
            <ActiveThread threadId={threadId} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function ScoutTabs({
  view,
  setView,
}: {
  view: "chat" | "reports";
  setView: (next: "chat" | "reports") => void;
}) {
  return (
    <nav className="flex shrink-0 border-b border-gray-200 bg-gray-50">
      <TabButton
        active={view === "chat"}
        onClick={() => setView("chat")}
        label="Chat"
      />
      <TabButton
        active={view === "reports"}
        onClick={() => setView("reports")}
        label="Reports"
      />
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "-mb-px border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-700"
          : "px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
      }
    >
      {label}
    </button>
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
          <strong>Chat</strong> for free-form opposition research,{" "}
          <strong>Debrief</strong> to walk through a recent match, or{" "}
          <strong>Scout</strong> to build a report PDF for an upcoming fixture.
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
    thread: { id: string; title: string; mode: ScoutMode };
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      parts: unknown[];
      attachmentIds: string[];
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
  // Historical attachment ids by message id. Live messages (still streaming
  // / not yet refetched) won't appear here — that's fine; the user just
  // sees thumbnails on the next thread reload.
  const attachmentIdsByMessage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of loaded.messages) {
      if (m.attachmentIds.length > 0) map.set(m.id, m.attachmentIds);
    }
    return map;
  }, [loaded.messages]);

  const { messages, sendMessage, status, error, stop } = useScoutChat({
    threadId,
    initialMessages,
  });

  // Per-turn attachment chips (paste / drop / + button). Cap of 4 mirrors
  // the BE schema; the hook drops anything over silently rather than
  // mid-upload-rejecting.
  const {
    attachments: turnAttachments,
    upload: uploadAttachment,
    remove: removeAttachment,
    clear: clearAttachments,
    readyIds: attachmentIds,
    isUploading: isUploadingAttachments,
  } = useAttachmentUpload({ threadId, maxPerTurn: 4 });

  // Live binding of attachment ids to the user-turn message id we generate
  // and pass to useChat. Keeps the chip visible mid-session — without this
  // the thumbnail vanishes the moment we clear the composer because
  // attachmentIdsByMessage only knows about server-loaded messages.
  // Survives across re-renders but is wiped on thread switch (component
  // unmount); persistence is handled by the BE attachment_ids column,
  // which lights up attachmentIdsByMessage on the next thread load.
  const [liveAttachmentMap, setLiveAttachmentMap] = useState<
    Map<string, string[]>
  >(new Map());

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

  // Per-turn reasoning mode. URL-state-backed so it survives reload and
  // sticks per thread within a tab session. Default "thinking" — DeepSeek-
  // v4-pro reasons by default and most prompts benefit from it; the toggle
  // is for when the user wants a quick follow-up.
  const thinkingMode: ThinkingMode =
    searchParams.get("think") === "fast" ? "fast" : "thinking";
  const setThinkingMode = (next: ThinkingMode) => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next === "fast") sp.set("think", "fast");
        else sp.delete("think");
        return sp;
      },
      { replace: true },
    );
  };

  const send = (text: string) => {
    // Mint our own message id so the live attachment map can be keyed off
    // the same id useChat uses. crypto.randomUUID is available in every
    // browser we target.
    const messageId = crypto.randomUUID();
    if (attachmentIds.length > 0) {
      const ids = attachmentIds;
      setLiveAttachmentMap((prev) => {
        const next = new Map(prev);
        next.set(messageId, ids);
        return next;
      });
    }
    void sendMessage(
      { id: messageId, role: "user", parts: [{ type: "text", text }] },
      {
        body: {
          thinkingMode,
          // Only send ids of fully-committed attachments. The Composer
          // disables Send while any chip is uploading/processing, so this
          // is the full intended set.
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        },
      },
    );
    clearAttachments();
  };

  // Auto-scroll to the bottom when new content arrives.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";
  const mode = loaded.thread.mode;

  // When the chat connection drops mid-report, useChat surfaces a generic
  // "network error" with no useful info. The report's pipeline card stays
  // pinned at "generating" because the BE's emit("failed", ...) never made
  // it across the wire. Detect the in-flight report from the messages we
  // DO have and render a banner that points the user at the Reports tab —
  // research and analysis often complete server-side even after the
  // connection severs, so a refresh in a few minutes is usually the right
  // move.
  //
  // Walking newest→oldest, we track every reportId we've seen in a terminal
  // state (ready / failed) so a stale "generating" snapshot for the same
  // reportId emitted earlier in the stream doesn't get surfaced as
  // in-flight.
  const inFlightReport = useMemo<ReportData | null>(() => {
    const terminalReportIds = new Set<string>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const parts = messages[i].parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];
        if (
          typeof part !== "object" ||
          part === null ||
          !("type" in part) ||
          (part as { type: unknown }).type !== "data-report"
        ) {
          continue;
        }
        const data = (part as { data: ReportData }).data;
        if (data.status === "generating") {
          if (!terminalReportIds.has(data.reportId)) return data;
        } else {
          terminalReportIds.add(data.reportId);
        }
      }
    }
    return null;
  }, [messages]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <h2 className="my-0 flex items-center gap-2 truncate text-sm font-medium text-gray-700">
          {mode === "debrief" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase">
              Debrief
            </span>
          )}
          {mode === "scout" && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-800 uppercase">
              Scout
            </span>
          )}
          <span className="truncate">{loaded.thread.title}</span>
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
        {messages.length === 0 &&
          (mode === "debrief" ? (
            <DebriefLauncher onLaunch={send} />
          ) : mode === "scout" ? (
            <ScoutLauncher onLaunch={send} />
          ) : (
            <div className="mt-8 text-center text-sm text-gray-400">
              New thread. Ask a question to get started.
            </div>
          ))}
        {messages.map((m) => {
          const ids =
            attachmentIdsByMessage.get(m.id) ??
            liveAttachmentMap.get(m.id) ??
            [];
          return (
            <div key={m.id}>
              {ids.length > 0 && (
                <MessageAttachments threadId={threadId} attachmentIds={ids} />
              )}
              <MessageView
                message={m}
                onAnswerQuestion={send}
                isStreaming={isStreaming}
              />
            </div>
          );
        })}
        {error && (
          <div className="my-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {inFlightReport ? (
              <div className="space-y-1">
                <div className="font-medium">
                  Connection to Scout dropped while a report was generating.
                </div>
                <div>
                  The researcher and analyst phases often keep running
                  server-side even after the chat disconnects. Check the{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchParams(
                        (prev) => {
                          const sp = new URLSearchParams(prev);
                          sp.set("view", "reports");
                          return sp;
                        },
                        { replace: true },
                      );
                    }}
                    className="underline hover:text-red-900"
                  >
                    Reports tab
                  </button>{" "}
                  in a few minutes — if the report finished, it'll be there.
                </div>
                <div className="text-[11px] text-red-600/80">
                  Original error: {error.message}
                </div>
              </div>
            ) : (
              error.message
            )}
          </div>
        )}
      </div>
      <Composer
        initialDraft={draft}
        onDraftChange={setDraft}
        isStreaming={isStreaming}
        thinkingMode={thinkingMode}
        onThinkingModeChange={setThinkingMode}
        onSubmit={send}
        onStop={() => void stop()}
        attachments={turnAttachments}
        onUploadFile={(file) => void uploadAttachment(file)}
        onRemoveAttachment={removeAttachment}
        isUploadingAttachments={isUploadingAttachments}
      />
    </>
  );
}
