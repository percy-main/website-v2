import type { PendingAttachment } from "./use-attachment-upload.js";

interface AttachmentPreviewProps {
  attachment: PendingAttachment;
  onRemove: (localId: string) => void;
}

export function AttachmentPreview({
  attachment,
  onRemove,
}: AttachmentPreviewProps) {
  const { kind, filename, sizeBytes, status, previewUrl, error } = attachment;
  const failed = status === "failed";
  const busy = status === "uploading" || status === "processing";

  return (
    <div
      className={
        "relative flex max-w-[220px] items-center gap-2 rounded border px-2 py-1.5 text-xs " +
        (failed
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-gray-300 bg-gray-50 text-gray-700")
      }
      title={error ?? filename}
    >
      <Thumb kind={kind} previewUrl={previewUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{filename}</div>
        <div className="text-[10px] text-gray-500">
          {formatBytes(sizeBytes)}
          {busy && (
            <>
              {" · "}
              {status === "uploading" ? "uploading…" : "processing…"}
            </>
          )}
          {failed && (
            <>
              {" · "}
              <span className="text-red-600">failed</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(attachment.localId)}
        title="Remove attachment"
        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Thumb({
  kind,
  previewUrl,
}: {
  kind: PendingAttachment["kind"];
  previewUrl: string | null;
}) {
  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded object-cover"
      />
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-200 text-[10px] font-semibold tracking-wide text-gray-600 uppercase">
      {kind === "pdf" ? "PDF" : "IMG"}
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
