import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type Categories =
  paths["/api/expense-categories"]["get"]["responses"]["200"]["content"]["application/json"];

export function ManageExpenseTagsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => callApi(api.GET("/api/expense-categories")),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (name: string) =>
      callApi(api.POST("/api/expense-categories", { body: { name } })),
    onSuccess: async () => {
      setNewName("");
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: ["expenses", "categories"],
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const patch = useMutation({
    mutationFn: (vars: {
      id: string;
      body: { name?: string; archived?: boolean };
    }) =>
      callApi(
        api.PATCH("/api/expense-categories/{categoryId}", {
          params: { path: { categoryId: vars.id } },
          body: vars.body,
        }),
      ),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: ["expenses", "categories"],
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const categories: Categories["categories"] = data?.categories ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage expense tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New tag name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              disabled={!newName.trim() || add.isPending}
              onClick={() => add.mutate(newName.trim())}
            >
              Add
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Input
                  value={drafts[c.id] ?? c.name}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={patch.isPending}
                  onClick={() =>
                    patch.mutate({
                      id: c.id,
                      body: { name: (drafts[c.id] ?? c.name).trim() },
                    })
                  }
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={patch.isPending}
                  onClick={() =>
                    patch.mutate({ id: c.id, body: { archived: true } })
                  }
                >
                  Archive
                </Button>
              </li>
            ))}
            {categories.length === 0 && (
              <li className="text-sm text-stone-400">No tags yet.</li>
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
