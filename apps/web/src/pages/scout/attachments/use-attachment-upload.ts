import { api, callApi } from "@/lib/api-client";
import { useState } from "react";

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
type AcceptedContentType = (typeof ACCEPTED_TYPES)[number];

export const ATTACHMENT_ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

export interface PendingAttachment {
  /** Local-only id while uploading. Replaced with the server id once mint
   *  succeeds — the chip key still uses the local id so React doesn't
   *  unmount the row mid-upload. */
  localId: string;
  /** Server attachment id, set on mint. */
  id: string | null;
  filename: string;
  contentType: AcceptedContentType;
  sizeBytes: number;
  kind: "image" | "pdf";
  /** Object URL for an image preview thumbnail. PDF chips don't get one. */
  previewUrl: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
}

export const isAcceptedAttachment = (file: File): boolean =>
  (ACCEPTED_TYPES as readonly string[]).includes(file.type);

interface UseAttachmentUploadArgs {
  threadId: string;
  /** Per-turn cap. Reject up-front if adding the file would exceed it. */
  maxPerTurn: number;
}

/**
 * Manages the per-turn pending-attachment list. Each call to `upload(file)`
 * runs the three-step flow:
 *   1. POST /scout/threads/:id/attachments (mint) → { id, uploadUrl, ... }
 *   2. PUT to S3 directly (browser → uploads bucket)
 *   3. POST /scout/threads/:id/attachments/:id/commit → ready / failed
 *
 * State is local to the hook. The parent reads `attachments` to render
 * chips and `attachmentIds` to attach to the next sendMessage body.
 */
export function useAttachmentUpload({
  threadId,
  maxPerTurn,
}: UseAttachmentUploadArgs) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const update = (localId: string, patch: Partial<PendingAttachment>) => {
    setAttachments((prev) =>
      prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
    );
  };

  const upload = async (file: File): Promise<void> => {
    if (!isAcceptedAttachment(file)) return;

    const localId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random()}`;
    const contentType = file.type as AcceptedContentType;
    const kind: "image" | "pdf" =
      contentType === "application/pdf" ? "pdf" : "image";
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : null;

    const pending: PendingAttachment = {
      localId,
      id: null,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
      kind,
      previewUrl,
      status: "uploading",
      error: null,
    };

    // Reject before mint if the cap would be exceeded so we don't burn an
    // S3 PUT only to silently drop the chip.
    let exceeded = false;
    setAttachments((prev) => {
      if (prev.length >= maxPerTurn) {
        exceeded = true;
        return prev;
      }
      return [...prev, pending];
    });
    if (exceeded) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      return;
    }

    try {
      const mint = await callApi(
        api.POST("/api/scout/threads/{threadId}/attachments", {
          params: { path: { threadId } },
          body: {
            filename: file.name,
            contentType,
            sizeBytes: file.size,
          },
        }),
      );
      update(localId, { id: mint.id });

      const putRes = await fetch(mint.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        throw new Error(
          `Upload to S3 failed (${putRes.status} ${putRes.statusText})`,
        );
      }

      update(localId, { status: "processing" });

      const committed = await callApi(
        api.POST(
          "/api/scout/threads/{threadId}/attachments/{attachmentId}/commit",
          {
            params: {
              path: { threadId, attachmentId: mint.id },
            },
          },
        ),
      );
      update(localId, {
        status: committed.processingState === "ready" ? "ready" : "failed",
        error: committed.processingError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      update(localId, { status: "failed", error: message });
    }
  };

  const remove = (localId: string) => {
    const target = attachments.find((a) => a.localId === localId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    // Best-effort: ask the server to drop the row + S3 bytes if mint
    // already returned. Not awaited — the chip is gone locally either way.
    if (target?.id) {
      void callApi(
        api.DELETE("/api/scout/threads/{threadId}/attachments/{attachmentId}", {
          params: { path: { threadId, attachmentId: target.id } },
        }),
      ).catch(() => undefined);
    }
  };

  const clear = () => {
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
  };

  const readyIds = attachments.flatMap((a) =>
    a.status === "ready" && a.id ? [a.id] : [],
  );
  const isUploading = attachments.some(
    (a) => a.status === "uploading" || a.status === "processing",
  );

  return {
    attachments,
    upload,
    remove,
    clear,
    readyIds,
    isUploading,
  };
}
