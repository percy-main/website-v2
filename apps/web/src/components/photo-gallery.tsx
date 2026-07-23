import { galleryThumbLabel, type GalleryImage } from "@/lib/photo-gallery.js";
import { cn } from "@/lib/utils.js";
import { useEffect, useRef, useState } from "react";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";
import { OptimisedImage } from "./optimised-image.js";

// The photoGallery block's public rendering: one main photo above a
// thumbnail strip with previous/next arrows. The stage, thumb and arrow
// pieces are exported for the editor block, which rebuilds the same
// layout with editing affordances (the PersonCardShell precedent).

/**
 * The main-photo area. A fixed 3:2 stage so a gallery of mixed
 * portrait/landscape photos never jumps in height as the selection
 * changes; the photo sizes naturally and centres, so the page
 * background (not a letterbox slab) shows around portraits and the
 * visible photo keeps the content-image rounded corners. The photo is
 * absolutely positioned: in-flow content could stretch the stage past
 * its aspect ratio (it's only a preferred height), abspos content
 * cannot. `[&_picture]:contents` lifts the img out of its <picture>
 * wrapper so the inset positioning resolves against the stage.
 */
export function GalleryStage({ image }: { image: GalleryImage }) {
  return (
    <div
      aria-live="polite"
      className="photo-gallery-stage relative aspect-[3/2] w-full [&_picture]:contents"
    >
      <OptimisedImage
        picture={image.picture}
        alt={image.alt ?? ""}
        // h-auto/w-auto out-rank the width/height attributes so the
        // max clamps scale the photo instead of squishing it.
        className="absolute inset-0 m-auto h-auto max-h-full w-auto max-w-full rounded-lg shadow-md"
        sizes="(max-width: 672px) 100vw, 672px"
      />
    </div>
  );
}

/** A clickable strip thumbnail. The button carries the accessible name,
 * so the thumbnail image itself is decorative. */
export function GalleryThumbButton({
  image,
  label,
  selected,
  onSelect,
  ref,
}: {
  image: GalleryImage;
  label: string;
  selected: boolean;
  onSelect: () => void;
  ref?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-current={selected}
      onClick={onSelect}
      className={cn(
        "photo-gallery-thumb h-16 w-24 shrink-0 overflow-hidden rounded-md",
        selected
          ? "ring-primary ring-2 ring-offset-1"
          : "opacity-75 hover:opacity-100",
      )}
    >
      <OptimisedImage
        picture={image.picture}
        alt=""
        className="h-full w-full object-cover"
        sizes="96px"
      />
    </button>
  );
}

export function GalleryArrowButton({
  direction,
  label,
  onClick,
}: {
  direction: "previous" | "next";
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "previous" ? IoChevronBack : IoChevronForward;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm hover:bg-stone-100 hover:text-stone-900"
    >
      <Icon aria-hidden />
    </button>
  );
}

/**
 * Public photo gallery. Arrows wrap around; clicking a thumbnail shows
 * that photo on the stage. A single-photo gallery renders without the
 * strip. Prerender-safe: the first photo and every thumbnail are in the
 * initial markup, interaction arrives with hydration.
 */
export function PhotoGallery({ images }: { images: GalleryImage[] }) {
  const [selected, setSelected] = useState(0);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Guards the scroll effect on mount: "nearest" would still scroll the
  // page vertically to an offscreen gallery during initial load.
  const mountedRef = useRef(false);
  const count = images.length;
  // Defensive clamp: state is internal so it can't normally exceed the
  // array, but a stale index must never blank the stage.
  const index = Math.min(selected, count - 1);
  const current = images[index];

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    thumbRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [index]);

  if (!current) return null;

  return (
    <figure
      role="group"
      aria-roledescription="carousel"
      aria-label="Photo gallery"
      className="my-4 flex w-full max-w-2xl flex-col self-center"
    >
      <GalleryStage image={current} />
      {current.caption && (
        <figcaption className="mt-2 text-sm text-stone-600">
          {current.caption}
        </figcaption>
      )}
      {count > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <GalleryArrowButton
            direction="previous"
            label="Previous photo"
            onClick={() => {
              setSelected((index - 1 + count) % count);
            }}
          />
          {/* Position keys: a pure projection of immutable stored data,
              same justification as the renderer's inline keys. p-1 keeps
              the selection ring inside the scroll clip at the ends. */}
          <div className="flex flex-1 gap-2 overflow-x-auto p-1">
            {images.map((image, i) => (
              <GalleryThumbButton
                // eslint-disable-next-line react-doctor/no-array-index-as-key -- see comment above: pure projection of immutable stored data
                key={`thumb-${String(i)}`}
                image={image}
                label={galleryThumbLabel(image, i)}
                selected={i === index}
                onSelect={() => {
                  setSelected(i);
                }}
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
              />
            ))}
          </div>
          <GalleryArrowButton
            direction="next"
            label="Next photo"
            onClick={() => {
              setSelected((index + 1) % count);
            }}
          />
        </div>
      )}
    </figure>
  );
}
