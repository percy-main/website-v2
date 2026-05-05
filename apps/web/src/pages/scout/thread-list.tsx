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
import { FactsAdminButton } from "./facts-admin.js";

type ScoutMode = "chat" | "debrief" | "scout";

interface ThreadSummary {
  id: string;
  title: string;
  mode: ScoutMode;
  updatedAt: string;
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

export function ThreadList() {
  const params = useParams<{ threadId?: string }>();
  const activeThreadId = params.threadId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary | null>(
    null,
  );
  // Active mode for the split-button. Local state — survives clicks within
  // the page but not reload; the dropdown is a transient affordance, not a
  // navigable URL state.
  const [activeMode, setActiveMode] = useState<ScoutMode>("chat");

  const threadsQuery = useQuery({
    queryKey: ["scout", "threads"],
    queryFn: () => callApi(api.GET("/api/scout/threads")),
  });

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
    },
  });

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      {/* h-12 matches ChatView's header (also h-12). Same fixed height
          on both sides keeps the border-bottom divider continuous across
          the sidebar/main split, regardless of the natural size of the
          contents on either side. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        <NewThreadSplitButton
          activeMode={activeMode}
          onModeChange={setActiveMode}
          onCreate={() => createMutation.mutate(activeMode)}
          pending={createMutation.isPending}
        />
        <FactsAdminButton />
      </div>
      <div className="flex-1 overflow-y-auto">
        {threadsQuery.isLoading && (
          <div className="p-3 text-sm text-gray-500">Loading…</div>
        )}
        {threadsQuery.error && (
          <div className="p-3 text-sm text-red-600">
            {threadsQuery.error instanceof Error
              ? threadsQuery.error.message
              : "Failed to load threads"}
          </div>
        )}
        {threadsQuery.data?.threads.length === 0 && (
          <div className="p-3 text-sm text-gray-500">
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
                  className={`block px-3 py-2 pr-10 text-sm hover:bg-white ${
                    isActive
                      ? "bg-white font-medium text-blue-700"
                      : "text-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <ModeBadge mode={t.mode} />
                    <span className="truncate">{t.title}</span>
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${t.title}`}
                  className="absolute top-2 right-2 rounded p-1 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-200 hover:text-red-700"
                  onClick={(e) => {
                    e.preventDefault();
                    setPendingDelete(t);
                  }}
                >
                  ×
                </button>
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
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={false}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) {
                  void callApi(
                    api.DELETE("/api/scout/threads/{threadId}", {
                      params: { path: { threadId: pendingDelete.id } },
                    }),
                  ).then(async () => {
                    await queryClient.invalidateQueries({
                      queryKey: ["scout", "threads"],
                    });
                    if (pendingDelete.id === activeThreadId)
                      void navigate("/scout");
                    setPendingDelete(null);
                  });
                }
              }}
            >
              Delete
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

// ── Split-button: pick mode from the dropdown, click to create ──────────
//
// Three modes (Chat / Debrief / Scout). Left button creates a thread of the
// active mode; right caret opens a Radix DropdownMenu radio group so the
// captain can flip the active mode. Local state — no need to persist the
// selection across reloads.
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
        className="flex-1 rounded-l-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {pending ? "Creating…" : `New ${activeLabel.toLowerCase()}`}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Choose new-thread mode"
          disabled={pending}
          className="flex items-center justify-center rounded-r-md border-l border-gray-700 bg-gray-900 px-2 py-1.5 text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-60"
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
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
                <span className="text-sm font-medium text-gray-900">
                  {opt.label}
                </span>
                <span className="text-xs text-gray-500">{opt.description}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
