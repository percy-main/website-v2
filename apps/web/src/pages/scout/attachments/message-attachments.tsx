import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery } from "@/lib/authed-query.js";

interface MessageAttachmentsProps {
  threadId: string;
  attachmentIds: string[];
}

/**
 * Inline attachment thumbnails for historical user-turn messages. Each id
 * is fetched independently so react-query can dedupe across re-renders and
 * chat-history scrolls; the API returns a per-attachment signed URL.
 */
export function MessageAttachments({
  threadId,
  attachmentIds,
}: MessageAttachmentsProps) {
  if (attachmentIds.length === 0) return null;

  return (
    <div className="my-1.5 ml-auto flex max-w-3xl flex-wrap justify-end gap-1.5">
      {attachmentIds.map((attachmentId) => (
        <AttachmentChip
          key={attachmentId}
          threadId={threadId}
          attachmentId={attachmentId}
        />
      ))}
    </div>
  );
}

function AttachmentChip({
  threadId,
  attachmentId,
}: {
  threadId: string;
  attachmentId: string;
}) {
  const { data, isLoading, error } = useAuthedQuery({
    queryKey: ["scout", "attachment", threadId, attachmentId],
    queryFn: () =>
      callApi(
        api.GET("/api/scout/threads/{threadId}/attachments/{attachmentId}", {
          params: { path: { threadId, attachmentId } },
        }),
      ),
    // The signed URL expires after 30 min. Re-fetch when stale; staleTime
    // a bit shorter than that gives us headroom.
    staleTime: 25 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-12 w-32 animate-pulse rounded border border-stone-200 bg-stone-100" />
    );
  }
  if (error || !data) {
    return (
      <div className="h-12 w-32 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
        attachment unavailable
      </div>
    );
  }

  const { kind, filename, signedUrl, sizeBytes } = data;
  const isImage = kind === "image" && signedUrl;

  return (
    <a
      href={signedUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      title={filename}
      className="flex h-12 max-w-[200px] items-center gap-2 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
    >
      {isImage ? (
        <img
          src={signedUrl}
          alt=""
          className="size-9 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded bg-stone-200 text-[10px] font-semibold tracking-wide text-stone-600 uppercase">
          {kind === "pdf" ? "PDF" : "IMG"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{filename}</div>
        <div className="text-[10px] text-stone-500">
          {formatBytes(sizeBytes)}
        </div>
      </div>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
