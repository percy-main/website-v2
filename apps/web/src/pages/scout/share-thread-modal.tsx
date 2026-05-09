import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface ShareActor {
  id: string;
  name: string;
  email: string;
}

interface Props {
  threadId: string;
  threadTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareThreadModal({
  threadId,
  threadTitle,
  open,
  onOpenChange,
}: Props) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  // Multi-select staging: officials ticked but not yet committed. The
  // commit lands on "Share" — keeps the modal feel transactional rather
  // than firing a network call per checkbox tick.
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Officials picker. Only enabled while the modal is open so we don't
  // hit the API every page render. Stale-time short — list rarely changes
  // mid-session but a new official COULD appear via the admin UI.
  const officialsQuery = useQuery({
    queryKey: ["scout", "officials"],
    queryFn: () => callApi(api.GET("/api/scout/officials")),
    enabled: open,
    staleTime: 30_000,
  });

  // Current sharees for this thread. Owner-only endpoint; we surface a
  // friendly empty state (rather than a generic error) when it 403s,
  // since the modal is owner-only by construction anyway.
  const shareesQuery = useQuery({
    queryKey: ["scout", "thread-shares", threadId],
    queryFn: () =>
      callApi(
        api.GET("/api/scout/threads/{threadId}/shares", {
          params: { path: { threadId } },
        }),
      ),
    enabled: open,
  });

  const sharedIds = new Set(shareesQuery.data?.sharees.map((s) => s.id) ?? []);

  const candidates = (() => {
    const all = officialsQuery.data?.officials ?? [];
    const q = filter.trim().toLowerCase();
    return all.filter(
      (o) =>
        !sharedIds.has(o.id) &&
        (q === "" ||
          o.name.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q)),
    );
  })();

  const shareMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      callApi(
        api.POST("/api/scout/threads/{threadId}/shares", {
          params: { path: { threadId } },
          body: { userIds },
        }),
      ),
    onSuccess: async () => {
      setSelectedToAdd(new Set());
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["scout", "thread-shares", threadId],
        }),
        queryClient.invalidateQueries({ queryKey: ["scout", "threads"] }),
      ]);
    },
  });

  const unshareMutation = useMutation({
    mutationFn: (userId: string) =>
      callApi(
        api.DELETE("/api/scout/threads/{threadId}/shares/{userId}", {
          params: { path: { threadId, userId } },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["scout", "thread-shares", threadId],
        }),
        queryClient.invalidateQueries({ queryKey: ["scout", "threads"] }),
      ]);
    },
  });

  const handleToggle = (id: string) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleShare = () => {
    if (selectedToAdd.size === 0) return;
    shareMutation.mutate(Array.from(selectedToAdd));
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/scout/${threadId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback: select the text in a hidden input. Rare path — modern
      // browsers grant clipboard write to user-gesture handlers.
      window.prompt("Copy this link:", url);
    }
  };

  const hasShares = (shareesQuery.data?.sharees.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share thread</DialogTitle>
          <DialogDescription>
            Give other officials read-only access to{" "}
            <span className="font-medium text-stone-900">{threadTitle}</span>.
            They&rsquo;ll see the full conversation but can&rsquo;t reply.
          </DialogDescription>
        </DialogHeader>

        {/* ── Already shared with ───────────────────────────────── */}
        {shareesQuery.data && hasShares ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-stone-500">
              Shared with
            </div>
            <ul className="divide-y divide-stone-100 rounded border border-stone-200">
              {shareesQuery.data.sharees.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-stone-900">
                      {s.name}
                    </div>
                    <div className="truncate text-xs text-stone-500">
                      {s.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => unshareMutation.mutate(s.id)}
                    disabled={unshareMutation.isPending}
                    className="text-xs text-stone-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ── Picker ────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Input
            placeholder="Search officials by name or email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={officialsQuery.isLoading}
          />
          <div className="max-h-48 overflow-y-auto rounded border border-stone-200">
            {officialsQuery.isLoading && (
              <div className="p-3 text-sm text-stone-500">Loading…</div>
            )}
            {!officialsQuery.isLoading && candidates.length === 0 && (
              <div className="p-3 text-sm text-stone-500">
                {filter
                  ? "No matching officials."
                  : hasShares
                    ? "Already shared with everyone available."
                    : "No other officials yet."}
              </div>
            )}
            <ul className="divide-y divide-stone-100">
              {candidates.map((o: ShareActor) => {
                const checked = selectedToAdd.has(o.id);
                return (
                  <li key={o.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-stone-50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => handleToggle(o.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-stone-900">
                          {o.name}
                        </div>
                        <div className="truncate text-xs text-stone-500">
                          {o.email}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {shareMutation.error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {shareMutation.error instanceof Error
              ? shareMutation.error.message
              : "Failed to share thread"}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCopyLink()}
            disabled={!hasShares}
            title={
              hasShares
                ? "Copy a link to this thread"
                : "Share with someone first, then copy the link"
            }
          >
            {copied ? "Link copied" : "Copy link"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              onClick={handleShare}
              disabled={selectedToAdd.size === 0 || shareMutation.isPending}
            >
              {shareMutation.isPending
                ? "Sharing…"
                : selectedToAdd.size === 0
                  ? "Share"
                  : `Share with ${String(selectedToAdd.size)}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
