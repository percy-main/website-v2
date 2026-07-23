import {
  GalleryStage,
  GalleryThumbButton,
} from "@/components/photo-gallery.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { uploadContentImage } from "@/lib/content-images.js";
import { galleryThumbLabel, type GalleryImage } from "@/lib/photo-gallery.js";
import { use, useId, useRef, useState } from "react";
import {
  BlockSettings,
  EMPTY_CARD_CLASSES,
  EmptyCardPrompt,
  INLINE_TEXT_INPUT_CLASSES,
} from "./block-controls.js";
import { EditorBlockPreview } from "./editor-block-preview.js";
import { UploadConsentContext } from "./upload-consent-context.js";

// WYSIWYG editor for the photoGallery block: the rendered gallery is the
// editor (the person grid precedent). The stage shows the selected photo
// with its caption edited in place; thumbnails select; a toolbar under
// the caption reorders and removes; the trailing dashed tile uploads
// more photos through the standard consent + EXIF-strip pipeline.

/** Thumb-sized dashed tile that adds photos to the gallery. */
function AddPhotosTile({
  uploading,
  onClick,
}: {
  uploading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Add photos to the gallery"
      disabled={uploading}
      onClick={onClick}
      className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed border-stone-300 text-stone-500 hover:border-stone-400 hover:bg-stone-50"
    >
      {uploading ? (
        <span className="text-xs">Uploading…</span>
      ) : (
        <span aria-hidden className="text-2xl leading-none text-stone-400">
          +
        </span>
      )}
    </button>
  );
}

/** Drop empty alt/caption rather than storing "" (NULL-for-unset). */
function normalise(image: GalleryImage): GalleryImage {
  return {
    picture: image.picture,
    ...(image.alt ? { alt: image.alt } : {}),
    ...(image.caption ? { caption: image.caption } : {}),
  };
}

export function PhotoGalleryEditor({
  images,
  onWrite,
}: {
  images: GalleryImage[];
  onWrite: (next: GalleryImage[]) => void;
}) {
  const consentConfirmed = use(UploadConsentContext);
  const [selected, setSelected] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputId = useId();

  const count = images.length;
  // Selection outlives removals: clamp rather than reset.
  const index = Math.min(selected, Math.max(count - 1, 0));
  const current = images[index];

  const startUpload = () => {
    setError(null);
    if (!consentConfirmed) {
      setError("Tick the photo consent box above before uploading images.");
      return;
    }
    fileInputRef.current?.click();
  };

  const onFilesChosen = async (files: File[]) => {
    setUploading(true);
    setError(null);
    // allSettled keeps selection order and, on a partial failure, keeps
    // the photos that did upload while surfacing the first error.
    const results = await Promise.allSettled(
      files.map((file) => uploadContentImage(file, {})),
    );
    const added: GalleryImage[] = [];
    let failure: unknown = null;
    for (const result of results) {
      if (result.status === "fulfilled") {
        added.push({ picture: result.value.picture });
      } else if (failure === null) {
        failure = result.reason;
      }
    }
    if (failure !== null) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Upload failed - try again",
      );
    }
    setUploading(false);
    if (added.length > 0) {
      onWrite([...images, ...added]);
      setSelected(count);
    }
  };

  const updateImage = (i: number, updates: Partial<GalleryImage>) => {
    onWrite(
      images.map((image, j) =>
        j === i ? normalise({ ...image, ...updates }) : image,
      ),
    );
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= count) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onWrite(next);
    setSelected(to);
  };

  const remove = (i: number) => {
    onWrite(images.filter((_, j) => j !== i));
    setSelected(Math.min(index, Math.max(count - 2, 0)));
  };

  return (
    <div className="relative w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) void onFilesChosen(files);
        }}
      />

      {current ? (
        <>
          <EditorBlockPreview>
            <GalleryStage image={current} />
          </EditorBlockPreview>
          {/* Edited in place, styled like the public figcaption. */}
          <input
            aria-label={`Caption for photo ${String(index + 1)}`}
            placeholder="Add a caption for this photo (optional)…"
            value={current.caption ?? ""}
            onChange={(e) => {
              updateImage(index, { caption: e.target.value });
            }}
            className={INLINE_TEXT_INPUT_CLASSES("mt-2 text-sm text-stone-600")}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">
              Photo {index + 1} of {count}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={() => {
                move(index, index - 1);
              }}
            >
              Move left
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={index === count - 1}
              onClick={() => {
                move(index, index + 1);
              }}
            >
              Move right
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                remove(index);
              }}
            >
              Remove photo
            </Button>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto p-1">
            {images.map((image, i) => (
              <GalleryThumbButton
                // eslint-disable-next-line react-doctor/no-array-index-as-key -- thumbs are stateless and selection is index-tracked; images carry no unique id (a photo can be added twice)
                key={`thumb-${String(i)}`}
                image={image}
                label={galleryThumbLabel(image, i)}
                selected={i === index}
                onSelect={() => {
                  setSelected(i);
                }}
              />
            ))}
            <AddPhotosTile uploading={uploading} onClick={startUpload} />
          </div>
          <BlockSettings label="Photo settings" title="Photo">
            <div className="flex flex-col gap-1">
              <Label htmlFor={altInputId}>
                Alt text for photo {index + 1} (screen readers)
              </Label>
              <Input
                id={altInputId}
                placeholder="Describe the photo"
                value={current.alt ?? ""}
                onChange={(e) => {
                  updateImage(index, { alt: e.target.value });
                }}
              />
              <span className="text-xs text-stone-500">
                Read aloud by screen readers - not shown on the page.
              </span>
            </div>
          </BlockSettings>
        </>
      ) : (
        <button
          type="button"
          aria-label="Add photos to the gallery"
          disabled={uploading}
          onClick={startUpload}
          className={EMPTY_CARD_CLASSES}
        >
          <EmptyCardPrompt prompt={uploading ? "Uploading…" : "Add photos"} />
        </button>
      )}

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
