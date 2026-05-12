import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

interface Props {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberModal({ groupId, open, onOpenChange }: Props) {
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const searchQuery = useQuery({
    queryKey: ["admin", "user-groups", "search", groupId, debounced],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/user-groups/{groupId}/search-users", {
          params: {
            path: { groupId },
            query: { q: debounced },
          },
        }),
      ),
    enabled: open && debounced.length > 0,
  });

  const addMember = useMutation({
    mutationFn: (memberId: string) =>
      callApi(
        api.POST("/api/admin/user-groups/{groupId}/members", {
          params: { path: { groupId } },
          body: { memberId },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "user-groups"] });
      void qc.invalidateQueries({
        queryKey: ["admin", "user-groups", "search", groupId],
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member to group</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Search by name or email…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          {debounced.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">
              Type a name or email to search.
            </p>
          ) : searchQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-stone-500">
              Searching…
            </p>
          ) : searchQuery.data?.users.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">
              No matching users (already-in-group users are hidden).
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {searchQuery.data?.users.map((u) => (
                <li
                  key={u.memberId}
                  className="flex items-center justify-between rounded border border-stone-200 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {u.name ?? "(no name)"}
                    </span>
                    <span className="text-xs text-stone-500">{u.email}</span>
                  </div>
                  <Button
                    size="sm"
                    disabled={addMember.isPending}
                    onClick={() => addMember.mutate(u.memberId)}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
