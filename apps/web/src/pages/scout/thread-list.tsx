import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { FactsAdminButton } from "./facts-admin.js";

type ScoutMode = "scouting" | "debrief";

interface ThreadSummary {
  id: string;
  title: string;
  mode: ScoutMode;
  updatedAt: string;
}

export function ThreadList() {
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

  const createMutation = useMutation({
    mutationFn: (mode: ScoutMode) =>
      callApi(
        api.POST("/api/scout/threads", {
          body: {
            title: mode === "debrief" ? "Match debrief" : "New thread",
            mode,
          },
        }),
      ),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "threads"],
      });
      void navigate(`/scout/${thread.id}`);
    },
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

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      {/* h-12 matches ChatView's header (also h-12). Same fixed height
          on both sides keeps the border-bottom divider continuous across
          the sidebar/main split, regardless of the natural size of the
          contents on either side. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => createMutation.mutate("scouting")}
          disabled={createMutation.isPending}
          title="Free-form scouting chat"
        >
          {createMutation.isPending ? "Creating…" : "New scout"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => createMutation.mutate("debrief")}
          disabled={createMutation.isPending}
          title="Guided post-match debrief"
        >
          Debrief
        </Button>
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
            No threads yet. Click &ldquo;New thread&rdquo; to start.
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
                    {t.mode === "debrief" && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-amber-800 uppercase">
                        Debrief
                      </span>
                    )}
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
