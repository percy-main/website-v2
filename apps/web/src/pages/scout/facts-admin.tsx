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
import type { paths } from "@/lib/api.gen.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer } from "react";

/**
 * Fact corpus admin — list / search / edit / delete the agent's
 * recorded knowledge. Surfaces as a Scout tab (not in the main admin
 * area) because the corpus is Scout-specific and the audience is
 * whoever has Scout access (admin/official roles), not all site
 * admins.
 *
 * Edits to `content` re-embed via Voyage; metadata-only edits skip
 * the embedding round-trip server-side.
 */

// Sourced from the generated OpenAPI types — no parallel hand-written
// interface to drift.
type Fact = NonNullable<
  paths["/api/scout/facts"]["get"]["responses"][200]["content"]["application/json"]["facts"]
>[number];
type Permanence = Fact["permanence"];

/**
 * Tab body for the Scout fact corpus. The parent (Scout page tabs)
 * owns mounting; we drive our own filter state + URL search params
 * so deep-links land on the right rows.
 */
interface FactsViewState {
  scope: "" | "user" | "club";
  q: string;
  tag: string;
  editing: Fact | null;
  pendingDelete: Fact | null;
}

const initialFactsViewState: FactsViewState = {
  scope: "",
  q: "",
  tag: "",
  editing: null,
  pendingDelete: null,
};

export function FactsAdminView() {
  const [state, update] = useReducer(
    (s: FactsViewState, p: Partial<FactsViewState>) => ({ ...s, ...p }),
    initialFactsViewState,
  );
  const { scope, q, tag, editing, pendingDelete } = state;

  const factsQuery = useQuery({
    queryKey: ["scout", "facts", { scope, q, tag }],
    queryFn: () =>
      callApi(
        api.GET("/api/scout/facts", {
          params: {
            query: {
              scope: scope === "" ? undefined : scope,
              q: q || undefined,
              tag: tag || undefined,
              page: 1,
              pageSize: 100,
            },
          },
        }),
      ),
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-medium text-stone-700">
          Scout fact corpus
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Review, edit, and prune knowledge Scout has recorded. Editing content
          regenerates the embedding so retrieval stays in sync.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-stone-200 px-4 py-3">
        <label className="flex flex-col text-xs text-stone-600">
          Scope
          <select
            className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
            value={scope}
            onChange={(e) =>
              update({ scope: e.target.value as "" | "user" | "club" })
            }
          >
            <option value="">All</option>
            <option value="club">Club</option>
            <option value="user">Personal</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col text-xs text-stone-600">
          Search
          <input
            className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="full-text query (e.g. 'covers')"
            value={q}
            onChange={(e) => update({ q: e.target.value })}
          />
        </label>
        <label className="flex flex-1 flex-col text-xs text-stone-600">
          Tag
          <input
            className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder="key:value (e.g. team:Mitford CC)"
            value={tag}
            onChange={(e) => update({ tag: e.target.value })}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {factsQuery.isLoading && (
          <div className="p-3 text-sm text-stone-500">Loading…</div>
        )}
        {factsQuery.error && (
          <div className="p-3 text-sm text-red-600">
            {factsQuery.error instanceof Error
              ? factsQuery.error.message
              : "Failed to load facts"}
          </div>
        )}
        {factsQuery.data && (
          <>
            <div className="px-1 pt-1 pb-1 text-xs text-stone-500">
              {factsQuery.data.total} fact
              {factsQuery.data.total === 1 ? "" : "s"} total
            </div>
            <ul className="divide-y divide-stone-100">
              {factsQuery.data.facts.map((f) => (
                <FactRow
                  key={f.id}
                  fact={f}
                  onEdit={() => update({ editing: f })}
                  onDelete={() => update({ pendingDelete: f })}
                />
              ))}
            </ul>
            {factsQuery.data.facts.length === 0 && (
              <div className="p-3 text-sm text-stone-500">
                No facts match the current filters.
              </div>
            )}
          </>
        )}
      </div>

      <FactEditDialog
        key={editing?.id ?? "none"}
        fact={editing}
        onClose={() => update({ editing: null })}
      />
      <FactDeleteDialog
        fact={pendingDelete}
        onClose={() => update({ pendingDelete: null })}
      />
    </div>
  );
}

function FactRow({
  fact,
  onEdit,
  onDelete,
}: {
  fact: Fact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tagPairs = Object.entries(fact.tags)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" / ") : v}`)
    .join(" · ");
  return (
    <li className="group flex items-start justify-between gap-3 px-1 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-stone-900">{fact.content}</div>
        <div className="mt-0.5 text-xs text-stone-500">
          {fact.scope === "user" ? "personal" : "club"} · confidence{" "}
          {fact.confidence}/5 ·{" "}
          <span className="font-medium">
            {fact.permanence ?? "permanence?"}
          </span>
          {tagPairs ? ` · ${tagPairs}` : ""}
          {" · "}
          {new Date(fact.createdAt).toLocaleDateString()}
        </div>
        {fact.sourceKbDocument && (
          <div className="mt-0.5 text-[11px] text-stone-500">
            From document:{" "}
            <span className="text-stone-700">
              {fact.sourceKbDocument.title}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          className="rounded border border-stone-200 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="rounded border border-stone-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

interface FactFormState {
  content: string;
  scope: "user" | "club";
  confidence: number;
  permanence: Permanence;
  tagsText: string;
}

function FactEditDialog({
  fact,
  onClose,
}: {
  fact: Fact | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Single shallow-merge reducer keeps the field setters as data-flow
  // through one `update({ ... })` call. The form mounts fresh per-fact via
  // `key={fact.id}` on the parent, so the initial values pin to mount.
  const [form, update] = useReducer(
    (state: FactFormState, patch: Partial<FactFormState>) => ({
      ...state,
      ...patch,
    }),
    {
      content: fact?.content ?? "",
      scope: fact?.scope ?? "club",
      confidence: fact?.confidence ?? 3,
      permanence: fact?.permanence ?? null,
      tagsText: fact ? JSON.stringify(fact.tags) : "{}",
    },
  );
  const { content, scope, confidence, permanence, tagsText } = form;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!fact) throw new Error("no fact");
      let parsedTags: Record<string, string | string[]> | undefined;
      try {
        parsedTags = JSON.parse(tagsText) as Record<string, string | string[]>;
      } catch {
        throw new Error('Tags must be valid JSON, e.g. {"team":"Mitford CC"}');
      }
      return callApi(
        api.PATCH("/api/scout/facts/{factId}", {
          params: { path: { factId: fact.id } },
          body: {
            content: content !== fact.content ? content : undefined,
            scope: scope !== fact.scope ? scope : undefined,
            confidence: confidence !== fact.confidence ? confidence : undefined,
            permanence: permanence !== fact.permanence ? permanence : undefined,
            tags: parsedTags,
          },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "facts"],
      });
      onClose();
    },
  });

  return (
    <Dialog
      open={fact !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit fact</DialogTitle>
          <DialogDescription>
            Changing the content regenerates the embedding so retrieval stays in
            sync. Other fields are metadata-only.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col text-xs text-stone-600">
          Content
          <textarea
            className="mt-1 min-h-[80px] rounded border border-stone-300 px-2 py-1 text-sm"
            value={content}
            onChange={(e) => update({ content: e.target.value })}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-col text-xs text-stone-600">
            Scope
            <select
              className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
              value={scope}
              onChange={(e) =>
                update({ scope: e.target.value as "user" | "club" })
              }
            >
              <option value="club">Club</option>
              <option value="user">Personal</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-stone-600">
            Confidence (1–5)
            <input
              type="number"
              min={1}
              max={5}
              className="mt-1 w-24 rounded border border-stone-300 px-2 py-1 text-sm"
              value={confidence}
              onChange={(e) =>
                update({
                  confidence: Math.max(1, Math.min(5, Number(e.target.value))),
                })
              }
            />
          </label>
          <label className="flex flex-col text-xs text-stone-600">
            Permanence
            <select
              className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
              value={permanence ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                update({ permanence: v === "" ? null : (v as Permanence) });
              }}
            >
              <option value="">Unknown</option>
              <option value="permanent">Permanent</option>
              <option value="seasonal">Seasonal</option>
              <option value="ephemeral">Ephemeral</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col text-xs text-stone-600">
          Tags (JSON)
          <textarea
            className="mt-1 min-h-[60px] rounded border border-stone-300 px-2 py-1 font-mono text-xs"
            value={tagsText}
            onChange={(e) => update({ tagsText: e.target.value })}
          />
        </label>

        {mutation.error && (
          <div className="text-sm text-red-600">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Update failed"}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FactDeleteDialog({
  fact,
  onClose,
}: {
  fact: Fact | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => {
      if (!fact) throw new Error("no fact");
      return callApi(
        api.DELETE("/api/scout/facts/{factId}", {
          params: { path: { factId: fact.id } },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["scout", "facts"],
      });
      onClose();
    },
  });

  return (
    <Dialog
      open={fact !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete fact?</DialogTitle>
          <DialogDescription>
            &ldquo;{fact?.content}&rdquo; will be removed from the corpus. This
            is hard-delete; citations referencing it will resolve to &ldquo;not
            found&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
