import { ImbuzaiMascot } from "@/components/imbuzai-mascot.js";
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
import { FactsAdminView } from "./facts-admin.js";
import { KnowledgeAdminView } from "./knowledge-admin.js";
import { MessageView } from "./message-view.js";
import { ReportsView } from "./reports-view.js";
import { ScoutLauncher } from "./scout-launcher.js";
import { ShareThreadModal } from "./share-thread-modal.js";
import { NewThreadButton, ThreadList } from "./thread-list.js";
import { useScoutChat } from "./use-scout-chat.js";

type ScoutMode = "chat" | "debrief" | "scout";
type ScoutView = "chat" | "reports" | "facts" | "knowledge";

const VIEW_FROM_PARAM: Record<string, ScoutView> = {
  reports: "reports",
  facts: "facts",
  knowledge: "knowledge",
};

export function Component() {
  useDocumentMeta("ImbuzAI");
  const { threadId } = useParams<{ threadId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL-state per the project's URL-state convention. The non-chat tabs
  // are global (not per-thread) so they survive switching between threads.
  const viewParam = searchParams.get("view") ?? "";
  const view: ScoutView = VIEW_FROM_PARAM[viewParam] ?? "chat";

  const setView = (next: ScoutView) => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next === "chat") sp.delete("view");
        else sp.set("view", next);
        return sp;
      },
      { replace: true },
    );
  };

  // Mobile-only drawer state. On lg+ the ThreadList renders inline as a
  // sidebar and this flag is ignored. Below lg, the sidebar is positioned
  // off-screen by default and slides in when this flips to true.
  const [threadDrawerOpen, setThreadDrawerOpen] = useState(false);

  // Snap the drawer shut if the viewport grows past lg — otherwise the
  // overlay/backdrop stays mounted under the now-visible sidebar.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setThreadDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Escape-to-close. Body scroll lock is left off — the drawer doesn't fill
  // the viewport (the site header is still visible above the scout shell)
  // and locking would cause the page to jump.
  useEffect(() => {
    if (!threadDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThreadDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadDrawerOpen]);

  return (
    <div className="container mx-auto h-[calc(100vh-8rem)] px-0">
      <div className="relative flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white">
        {threadDrawerOpen && (
          <button
            type="button"
            aria-label="Close threads"
            className="absolute inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setThreadDrawerOpen(false)}
          />
        )}
        <ThreadList
          mobileOpen={threadDrawerOpen}
          onMobileClose={() => setThreadDrawerOpen(false)}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <ScoutTabs
            view={view}
            setView={setView}
            onOpenThreadDrawer={() => setThreadDrawerOpen(true)}
          />
          {view === "reports" ? (
            <ReportsView />
          ) : view === "facts" ? (
            <FactsAdminView />
          ) : view === "knowledge" ? (
            <KnowledgeAdminView />
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
  onOpenThreadDrawer,
}: {
  view: ScoutView;
  setView: (next: ScoutView) => void;
  onOpenThreadDrawer: () => void;
}) {
  // h-12 matches the sidebar's NewThreadSplitButton container so the bottom
  // border on the tabs nav lines up exactly with the bottom border under
  // "New chat".
  return (
    <nav className="flex h-12 shrink-0 items-stretch border-b border-gray-200 bg-gray-50">
      <button
        type="button"
        onClick={onOpenThreadDrawer}
        aria-label="Open threads"
        className="inline-flex items-center px-3 text-gray-600 hover:text-gray-900 lg:hidden"
      >
        <ThreadsIcon className="h-5 w-5" />
      </button>
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
      <TabButton
        active={view === "facts"}
        onClick={() => setView("facts")}
        label="Facts"
      />
      <TabButton
        active={view === "knowledge"}
        onClick={() => setView("knowledge")}
        label="Knowledge"
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
          ? "-mb-px inline-flex items-center border-b-2 border-blue-600 px-4 text-sm font-medium text-blue-700"
          : "inline-flex items-center px-4 text-sm text-gray-600 hover:text-gray-900"
      }
    >
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-500">
      <div className="flex flex-col items-center gap-4">
        <ImbuzaiMascot width={140} loading="eager" />
        <div>
          <div className="font-secondary text-xl font-bold tracking-tight text-gray-800">
            ImbuzAI
          </div>
          <div className="mt-0.5 text-xs tracking-wider text-gray-500 uppercase">
            Percy Main's AI cricket analyst
          </div>
        </div>
        <div className="max-w-md">
          <div>
            <strong>Chat</strong> for free-form opposition research,{" "}
            <strong>Debrief</strong> to walk through a recent match, or{" "}
            <strong>Scout</strong> to build a report PDF for an upcoming
            fixture.
          </div>
        </div>
        <div className="flex w-64">
          <NewThreadButton />
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
    thread: {
      id: string;
      title: string;
      mode: ScoutMode;
      sharedBy: { id: string; name: string; email: string } | null;
      sharedByMe: boolean;
    };
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
  const isReadOnly = loaded.thread.sharedBy !== null;
  const [shareModalOpen, setShareModalOpen] = useState(false);

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
          <ImbuzaiMascot width={32} />
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
          {isReadOnly && (
            <span
              className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-800 uppercase"
              title={`Shared by ${loaded.thread.sharedBy?.name ?? ""}`}
            >
              Shared
            </span>
          )}
          {!isReadOnly && loaded.thread.sharedByMe && (
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-blue-800 uppercase"
              title="You've shared this thread"
            >
              Shared by you
            </span>
          )}
          <span className="truncate">{loaded.thread.title}</span>
        </h2>
        <div className="flex items-center gap-3">
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            >
              <ShareIcon className="h-3.5 w-3.5" />
              Share
            </button>
          )}
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
        </div>
      </header>
      {isReadOnly && loaded.thread.sharedBy && (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs text-violet-900">
          Shared by{" "}
          <span className="font-medium">{loaded.thread.sharedBy.name}</span>{" "}
          <span className="text-violet-700">
            · read-only — you can read the conversation but can&rsquo;t reply.
          </span>
        </div>
      )}
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
                  Connection to ImbuzAI dropped while a report was generating.
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
      {!isReadOnly && (
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
      )}
      {!isReadOnly && (
        <ShareThreadModal
          threadId={threadId}
          threadTitle={loaded.thread.title}
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
        />
      )}
    </>
  );
}

function ShareIcon({ className }: { className?: string }) {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function ThreadsIcon({ className }: { className?: string }) {
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
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
