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
import { useState } from "react";

/**
 * Scout knowledge base admin — list / upload / delete / reingest the
 * club-wide reference docs the agent retrieves from. Lives as a modal
 * alongside the Scout chat (not in the main admin area) for the same
 * reason facts-admin does: corpus is Scout-specific, audience is
 * whoever has Scout access.
 *
 * v1 keeps the surface tight: list + upload + delete + reingest +
 * status polling. Inline edit / detail panel / per-tag chips can be
 * layered on later — for now metadata changes go through the API
 * directly. Status badges poll while any row is in queued / ingesting.
 */

// Sourced from the generated OpenAPI types so the wire shape stays
// authoritative — no parallel hand-written interface to drift.
type KbDocument = NonNullable<
  paths["/api/scout/knowledge/documents"]["get"]["responses"][200]["content"]["application/json"]["documents"]
>[number];
type DocumentStatus = KbDocument["status"];

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
] as const;

const ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md";

/**
 * Tab body for the Scout knowledge base. The parent (Scout page tabs)
 * owns mounting; we drive our own filter state and the upload form.
 */
export function KnowledgeAdminView() {
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KbDocument | null>(null);
  const qc = useQueryClient();

  const docsQuery = useQuery({
    queryKey: ["scout", "knowledge", { search }],
    queryFn: () =>
      callApi(
        api.GET("/api/scout/knowledge/documents", {
          params: { query: { search: search.trim() || undefined } },
        }),
      ),
    // Auto-refresh while any row is mid-ingest. Cheap query (one DB
    // SELECT, no signed URLs) so 5s is fine.
    refetchInterval: (q) => {
      const data = q.state.data as { documents?: KbDocument[] } | undefined;
      const inFlight = data?.documents?.some(
        (d) => d.status === "queued" || d.status === "ingesting",
      );
      return inFlight ? 5_000 : false;
    },
  });

  const reingest = useMutation({
    mutationFn: (id: string) =>
      callApi(
        api.POST("/api/scout/knowledge/documents/{id}/reingest", {
          params: { path: { id } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout", "knowledge"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      callApi(
        api.DELETE("/api/scout/knowledge/documents/{id}", {
          params: { path: { id } },
        }),
      ),
    onSuccess: () => {
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["scout", "knowledge"] });
    },
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-medium text-stone-700">
          Scout knowledge base
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Upload PDFs, images, or plain text the agent should be able to search.
          Re-ingesting re-embeds chunks. Deleting cascades chunks but does not
          remove recorded facts derived from them.
        </p>
      </div>

      <div className="border-b border-stone-200 px-4 py-3">
        <UploadForm
          onUploaded={() => {
            void qc.invalidateQueries({ queryKey: ["scout", "knowledge"] });
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-stone-200 px-4 py-3">
        <label className="flex flex-1 flex-col text-xs text-stone-600">
          Search
          <input
            className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or filename"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {docsQuery.isLoading && (
          <div className="py-6 text-center text-sm text-stone-500">Loading…</div>
        )}
        {docsQuery.error && (
          <div className="py-6 text-center text-sm text-red-600">
            {docsQuery.error instanceof Error
              ? docsQuery.error.message
              : "Failed to load"}
          </div>
        )}
        {docsQuery.data &&
          (docsQuery.data.documents.length === 0 ? (
            <div className="py-6 text-center text-sm text-stone-500">
              No documents yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-medium">Title</th>
                  <th className="px-2 py-1 font-medium">Kind</th>
                  <th className="px-2 py-1 font-medium">Pages / Chunks</th>
                  <th className="px-2 py-1 font-medium">Status</th>
                  <th className="px-2 py-1 font-medium">Updated</th>
                  <th className="px-2 py-1 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docsQuery.data.documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onReingest={() => reingest.mutate(doc.id)}
                    onDelete={() => setPendingDelete(doc)}
                  />
                ))}
              </tbody>
            </table>
          ))}
      </div>

      {pendingDelete && (
        <DeleteConfirmDialog
          doc={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove.mutate(pendingDelete.id)}
          isDeleting={remove.isPending}
        />
      )}
    </div>
  );
}

interface UploadFormProps {
  onUploaded: () => void;
}

function UploadForm({ onUploaded }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Tags: simple "key:value, key:value2" syntax — array values via repeat.
  // Empty when admin doesn't care; service stores {} regardless.
  const [tagsRaw, setTagsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setTitle("");
    setDescription("");
    setTagsRaw("");
    setError(null);
  };

  const submit = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const contentType = file.type as (typeof ACCEPTED_TYPES)[number];
      if (!ACCEPTED_TYPES.includes(contentType)) {
        throw new Error(`Unsupported content type: ${file.type}`);
      }
      const tags = parseTagInput(tagsRaw);

      const mint = await callApi(
        api.POST("/api/scout/knowledge/documents", {
          body: {
            filename: file.name,
            contentType,
            sizeBytes: file.size,
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            tags,
          },
        }),
      );

      const putRes = await fetch(mint.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        throw new Error(
          `S3 upload failed (${putRes.status} ${putRes.statusText})`,
        );
      }

      await callApi(
        api.POST("/api/scout/knowledge/documents/{id}/commit", {
          params: { path: { id: mint.id } },
        }),
      );

      reset();
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded border border-dashed border-stone-300 bg-stone-50 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-stone-600">
          File
          <input
            type="file"
            accept={ACCEPT_ATTR}
            className="mt-1 text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-stone-600">
          Title (optional; defaults to filename)
          <input
            className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="2026 league handbook"
          />
        </label>
      </div>
      <label className="flex flex-col text-xs text-stone-600">
        Description (optional)
        <textarea
          rows={2}
          className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="flex flex-col text-xs text-stone-600">
        Tags (optional, comma-separated key:value)
        <input
          className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="topic:rules, season:2026"
        />
      </label>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={!file || busy}
        >
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

interface DocumentRowProps {
  doc: KbDocument;
  onReingest: () => void;
  onDelete: () => void;
}

function DocumentRow({ doc, onReingest, onDelete }: DocumentRowProps) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="p-2">
        <div className="font-medium text-stone-800">{doc.title}</div>
        <div className="text-[11px] text-stone-500">{doc.filename}</div>
        {doc.description && (
          <div className="mt-0.5 text-[11px] text-stone-500">
            {doc.description}
          </div>
        )}
      </td>
      <td className="p-2 text-xs text-stone-600">{doc.kind}</td>
      <td className="p-2 text-xs text-stone-600">
        {doc.pageCount !== null ? `${doc.pageCount} pp · ` : ""}
        {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
      </td>
      <td className="p-2">
        <StatusBadge status={doc.status} error={doc.errorMessage} />
      </td>
      <td className="p-2 text-xs text-stone-500">
        {new Date(doc.updatedAt).toLocaleDateString()}
      </td>
      <td className="space-x-2 p-2 text-right text-xs">
        <Button
          size="sm"
          variant="ghost"
          onClick={onReingest}
          disabled={doc.status === "queued" || doc.status === "ingesting"}
        >
          Reingest
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </td>
    </tr>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: DocumentStatus;
  error: string | null;
}) {
  const palette: Record<DocumentStatus, string> = {
    "awaiting-upload": "bg-stone-100 text-stone-700",
    queued: "bg-amber-100 text-amber-800",
    ingesting: "bg-blue-100 text-blue-800",
    ready: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <div>
      <span
        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${palette[status]}`}
      >
        {status}
      </span>
      {status === "failed" && error && (
        <div className="mt-0.5 text-[11px] text-red-700">{error}</div>
      )}
    </div>
  );
}

interface DeleteDialogProps {
  doc: KbDocument;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function DeleteConfirmDialog({
  doc,
  onCancel,
  onConfirm,
  isDeleting,
}: DeleteDialogProps) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete document?</DialogTitle>
          <DialogDescription>
            "{doc.title}": {doc.chunkCount} chunk
            {doc.chunkCount === 1 ? "" : "s"} will be removed. Recorded facts
            that referenced these chunks will keep their content but lose the
            "from document" link.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parse the comma-separated key:value tag input into the API's
 * Record<string, string | string[]> shape. Repeated keys collect
 * into an array. Whitespace is trimmed; entries without a colon are
 * dropped silently rather than erroring — admin gets a single Tags
 * input and the result is best-effort.
 */
function parseTagInput(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}
