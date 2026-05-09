import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

type ScoutMode = "chat" | "debrief" | "scout";

interface ThreadSummary {
  id: string;
  title: string;
  mode: ScoutMode;
  updatedAt: string;
  sharedBy: { id: string; name: string; email: string } | null;
  sharedByMe: boolean;
}

const MODE_OPTIONS: ReadonlyArray<{
  value: ScoutMode;
  label: string;
  description: string;
}> = [
  {
    value: "chat",
    label: "Chat",
    description: "Free-form scouting research and Q&A",
  },
  {
    value: "debrief",
    label: "Debrief",
    description: "Walk through a recent match — grow the fact corpus",
  },
  {
    value: "scout",
    label: "Scout",
    description: "Pick an upcoming fixture, build toward a report PDF",
  },
];

const TITLE_FOR_MODE: Record<ScoutMode, string> = {
  chat: "New thread",
  debrief: "Match debrief",
  scout: "Scouting report",
};

interface ThreadListProps {
  // Below lg the sidebar renders as an off-canvas drawer that slides in from
  // the left. mobileOpen drives the slide-in; onMobileClose lets the sidebar
  // dismiss itself when the captain picks a thread (so the chat content is
  // visible again immediately) or hits the close button. On lg+ both props
  // are ignored — the sidebar sits in normal flex flow.
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function ThreadList({ mobileOpen, onMobileClose }: ThreadListProps) {
  const params = useParams<{ threadId?: string }>();
  const activeThreadId = params.threadId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary | null>(
    null,
  );

  const threadsQuery = useQuery({
    queryKey: ["scout", "threads"],
    queryFn: () => callApi(api.GET("/api/scout/threads")),
  });

  const deleteMutation = useMutation({
    mutationFn: (threadId: string) =>
      callApi(
        api.DELETE("/api/scout/threads/{threadId}", {
          params: { path: { threadId } },
        }),
      ),
    onSuccess: async (_, threadId) => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "threads"],
      });
      setPendingDelete(null);
      if (threadId === activeThreadId) void navigate("/scout");
    },
  });

  // Below lg: drawer — fixed-position overlay that translates off/on screen.
  // lg+: in-flow sidebar at w-64. The lg: overrides reset every drawer-only
  // class so layout flips cleanly at the breakpoint.
  const asideClass = [
    "absolute inset-y-0 left-0 z-40 flex h-full w-72 transform flex-col border-r border-stone-200 bg-stone-50 shadow-xl transition-transform duration-200",
    mobileOpen ? "translate-x-0" : "-translate-x-full",
    "lg:relative lg:inset-auto lg:z-auto lg:w-64 lg:translate-x-0 lg:shadow-none lg:transition-none",
  ].join(" ");

  return (
    <aside className={asideClass}>
      {/* h-12 matches ChatView's header (also h-12). Same fixed height
          on both sides keeps the border-bottom divider continuous across
          the sidebar/main split, regardless of the natural size of the
          contents on either side. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 px-3">
        <NewThreadButton onCreated={onMobileClose} />
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close threads"
          className="rounded p-1 text-stone-500 hover:bg-stone-200 hover:text-stone-900 lg:hidden"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threadsQuery.isLoading && (
          <div className="p-3 text-sm text-stone-500">Loading…</div>
        )}
        {threadsQuery.error && (
          <div className="p-3 text-sm text-red-600">
            {threadsQuery.error instanceof Error
              ? threadsQuery.error.message
              : "Failed to load threads"}
          </div>
        )}
        {threadsQuery.data?.threads.length === 0 && (
          <div className="p-3 text-sm text-stone-500">
            No threads yet. Pick a mode and click &ldquo;New&rdquo; to start.
          </div>
        )}
        <ul>
          {threadsQuery.data?.threads.map((t) => {
            const isActive = t.id === activeThreadId;
            return (
              <li key={t.id} className="group relative">
                <Link
                  to={`/scout/${t.id}`}
                  onClick={onMobileClose}
                  className={`block px-3 py-2 pr-10 text-sm hover:bg-white ${
                    isActive
                      ? "bg-white font-medium text-blue-700"
                      : "text-stone-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <ModeBadge mode={t.mode} />
                    {t.sharedBy && (
                      <span
                        className="text-violet-600"
                        title={`Shared by ${t.sharedBy.name}`}
                        aria-label={`Shared by ${t.sharedBy.name}`}
                      >
                        <ShareGlyph className="size-3" />
                      </span>
                    )}
                    {t.sharedByMe && !t.sharedBy && (
                      <span
                        className="text-blue-600"
                        title="You've shared this thread"
                        aria-label="Shared by you"
                      >
                        <ShareGlyph className="size-3" />
                      </span>
                    )}
                    <span className="truncate">{t.title}</span>
                  </div>
                  <div className="truncate text-xs text-stone-400">
                    {t.sharedBy ? `Shared by ${t.sharedBy.name} · ` : ""}
                    {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </Link>
                {/* Recipients can't delete a shared-with-me thread; the BE
                    would 404 anyway, but hiding the button keeps the UX
                    obvious. */}
                {!t.sharedBy && (
                  <button
                    type="button"
                    aria-label={`Delete ${t.title}`}
                    className="absolute top-2 right-2 rounded p-1 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-200 hover:text-red-700"
                    onClick={(e) => {
                      e.preventDefault();
                      setPendingDelete(t);
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thread?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and all its messages will be
              permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : "Failed to delete thread"}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ModeBadge({ mode }: { mode: ScoutMode }) {
  if (mode === "debrief") {
    return (
      <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-amber-800 uppercase">
        Debrief
      </span>
    );
  }
  if (mode === "scout") {
    return (
      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-emerald-800 uppercase">
        Scout
      </span>
    );
  }
  return null;
}

// ── Self-contained "new thread" control ───────────────────────────────
//
// Owns its own activeMode state + create mutation + post-create navigate so
// the same control can drop into the sidebar header AND the empty-state
// hero without lifting state to a common parent. onCreated is the optional
// post-success hook — the sidebar uses it to dismiss the mobile drawer
// once a thread has been created.
export function NewThreadButton({ onCreated }: { onCreated?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Active mode for the split-button. Local state — survives clicks within
  // the page but not reload; the dropdown is a transient affordance, not a
  // navigable URL state.
  const [activeMode, setActiveMode] = useState<ScoutMode>("chat");

  const createMutation = useMutation({
    mutationFn: (mode: ScoutMode) =>
      callApi(
        api.POST("/api/scout/threads", {
          body: { title: TITLE_FOR_MODE[mode], mode },
        }),
      ),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "threads"],
      });
      void navigate(`/scout/${thread.id}`);
      onCreated?.();
    },
  });

  return (
    <NewThreadSplitButton
      activeMode={activeMode}
      onModeChange={setActiveMode}
      onCreate={() => createMutation.mutate(activeMode)}
      pending={createMutation.isPending}
    />
  );
}

// ── Split-button: pick mode from the dropdown, click to create ──────────
//
// Three modes (Chat / Debrief / Scout). Left button creates a thread of the
// active mode; right caret opens a Radix DropdownMenu radio group so the
// captain can flip the active mode. Stateless presentational component —
// state lives in NewThreadButton above.
function NewThreadSplitButton({
  activeMode,
  onModeChange,
  onCreate,
  pending,
}: {
  activeMode: ScoutMode;
  onModeChange: (mode: ScoutMode) => void;
  onCreate: () => void;
  pending: boolean;
}) {
  const activeLabel =
    MODE_OPTIONS.find((o) => o.value === activeMode)?.label ?? "Chat";

  return (
    <div className="flex flex-1">
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        title={`Start a new ${activeLabel.toLowerCase()} thread`}
        className="flex-1 rounded-l-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Creating…" : `New ${activeLabel.toLowerCase()}`}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Choose new-thread mode"
          disabled={pending}
          className="flex items-center justify-center rounded-r-md border-l border-stone-700 bg-stone-900 px-2 py-1.5 text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-60"
        >
          <ChevronDownIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup
            value={activeMode}
            onValueChange={(v) => onModeChange(v as ScoutMode)}
          >
            {MODE_OPTIONS.map((opt) => (
              <DropdownMenuRadioItem
                key={opt.value}
                value={opt.value}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className="text-sm font-medium text-stone-900">
                  {opt.label}
                </span>
                <span className="text-xs text-stone-500">
                  {opt.description}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
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

function ChevronDownIcon({ className }: { className?: string }) {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
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
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
