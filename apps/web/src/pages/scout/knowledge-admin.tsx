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

type DocumentStatus =
  | "awaiting-upload"
  | "queued"
  | "ingesting"
  | "ready"
  | "failed";
type DocumentKind = "pdf" | "image" | "text";

interface KbDocument {
  id: string;
  uploadedBy: string | null;
  title: string;
  description: string | null;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage: string | null;
  pageCount: number | null;
  chunkCount: number;
  tags: Record<string, string | string[]>;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeAdminButtonProps {
  className?: string;
}

export function KnowledgeAdminButton({ className }: KnowledgeAdminButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
      >
        Knowledge
      </Button>
      <KnowledgeAdminModal open={open} onOpenChange={setOpen} />
    </>
  );
}

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

function KnowledgeAdminModal({ open, onOpenChange }: ModalProps) {
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KbDocument | null>(null);
  const qc = useQueryClient();

  const docsQuery = useQuery({
    queryKey: ["scout", "knowledge", { search }],
    enabled: open,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Scout knowledge base</DialogTitle>
          <DialogDescription>
            Upload PDFs, images, or plain text the agent should be able to
            search. Re-ingesting re-embeds chunks (e.g. after a chunking-knob
            change). Deleting cascades chunks but does not remove recorded facts
            that were derived from them.
          </DialogDescription>
        </DialogHeader>

        <UploadForm
          onUploaded={() => {
            void qc.invalidateQueries({ queryKey: ["scout", "knowledge"] });
          }}
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-gray-200 pb-3">
          <label className="flex flex-1 flex-col text-xs text-gray-600">
            Search
            <input
              className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title or filename"
            />
          </label>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {docsQuery.isLoading && (
            <div className="py-6 text-center text-sm text-gray-500">
              Loading…
            </div>
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
              <div className="py-6 text-center text-sm text-gray-500">
                No documents yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-2 py-1 font-medium">Title</th>
                    <th className="px-2 py-1 font-medium">Kind</th>
                    <th className="px-2 py-1 font-medium">Pages / Chunks</th>
                    <th className="px-2 py-1 font-medium">Status</th>
                    <th className="px-2 py-1 font-medium">Updated</th>
                    <th className="px-2 py-1 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {docsQuery.data.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc as KbDocument}
                      onReingest={() => reingest.mutate(doc.id)}
                      onDelete={() => setPendingDelete(doc as KbDocument)}
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className="space-y-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-gray-600">
          File
          <input
            type="file"
            accept={ACCEPT_ATTR}
            className="mt-1 text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-gray-600">
          Title (optional — defaults to filename)
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="2026 league handbook"
          />
        </label>
      </div>
      <label className="flex flex-col text-xs text-gray-600">
        Description (optional)
        <textarea
          rows={2}
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        Tags (optional, comma-separated key:value)
        <input
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
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
    <tr className="border-t border-gray-100 align-top">
      <td className="px-2 py-2">
        <div className="font-medium text-gray-800">{doc.title}</div>
        <div className="text-[11px] text-gray-500">{doc.filename}</div>
        {doc.description && (
          <div className="mt-0.5 text-[11px] text-gray-500">
            {doc.description}
          </div>
        )}
      </td>
      <td className="px-2 py-2 text-xs text-gray-600">{doc.kind}</td>
      <td className="px-2 py-2 text-xs text-gray-600">
        {doc.pageCount !== null ? `${doc.pageCount} pp · ` : ""}
        {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
      </td>
      <td className="px-2 py-2">
        <StatusBadge status={doc.status} error={doc.errorMessage} />
      </td>
      <td className="px-2 py-2 text-xs text-gray-500">
        {new Date(doc.updatedAt).toLocaleDateString()}
      </td>
      <td className="space-x-2 px-2 py-2 text-right text-xs">
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
    "awaiting-upload": "bg-gray-100 text-gray-700",
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
            "{doc.title}" — {doc.chunkCount} chunk
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
