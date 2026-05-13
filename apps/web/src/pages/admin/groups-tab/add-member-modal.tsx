import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";

interface Props {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberModal({ groupId, open, onOpenChange }: Props) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const selectAllId = useId();

  const availableQuery = useQuery({
    queryKey: ["admin", "user-groups", "available", groupId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/user-groups/{groupId}/available-members", {
          params: { path: { groupId } },
        }),
      ),
    enabled: open,
  });

  const filteredMembers = useMemo(() => {
    const all = availableQuery.data?.members ?? [];
    const term = filter.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (m) =>
        (m.name?.toLowerCase().includes(term) ?? false) ||
        m.email.toLowerCase().includes(term),
    );
  }, [availableQuery.data, filter]);

  const toggle = (memberId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const allFilteredSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every((m) => selected.has(m.memberId));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const m of filteredMembers) next.delete(m.memberId);
      } else {
        for (const m of filteredMembers) next.add(m.memberId);
      }
      return next;
    });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/user-groups/{groupId}/members", {
          params: { path: { groupId } },
          body: { memberIds: Array.from(selected) },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "user-groups"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add members to group</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Filter by name or email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {availableQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-stone-500">Loading…</p>
          ) : availableQuery.data?.members.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">
              Every member is already in this group.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b pb-2 text-sm">
                <label
                  htmlFor={selectAllId}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Checkbox
                    id={selectAllId}
                    checked={allFilteredSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all visible members"
                  />
                  <span className="text-stone-600">
                    {filteredMembers.length} shown
                    {filter && availableQuery.data
                      ? ` of ${availableQuery.data.members.length}`
                      : ""}
                  </span>
                </label>
                <span className="text-stone-600">{selected.size} selected</span>
              </div>
              <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
                {filteredMembers.map((m) => {
                  const memberCheckboxId = `add-member-${m.memberId}`;
                  return (
                    <li key={m.memberId}>
                      <label
                        htmlFor={memberCheckboxId}
                        className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-stone-50"
                      >
                        <Checkbox
                          id={memberCheckboxId}
                          checked={selected.has(m.memberId)}
                          onCheckedChange={() => toggle(m.memberId)}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {m.name ?? "(no name)"}
                          </span>
                          <span className="text-xs text-stone-500">
                            {m.email}
                          </span>
                        </div>
                      </label>
                    </li>
                  );
                })}
                {filteredMembers.length === 0 && filter && (
                  <li className="py-4 text-center text-sm text-stone-500">
                    No members match "{filter}".
                  </li>
                )}
              </ul>
            </>
          )}
          {addMutation.isError && (
            <p className="text-sm text-red-600">
              Failed to add members. Please try again.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={addMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={selected.size === 0 || addMutation.isPending}
            >
              {addMutation.isPending
                ? "Adding…"
                : `Add ${selected.size} member${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
