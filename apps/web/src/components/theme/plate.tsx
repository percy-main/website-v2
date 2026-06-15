import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";

type PlateVariant = "paper" | "orange" | "navy";

interface PlateProps {
  children: ReactNode;
  /** Ink the printed sheet: paper (default), solid orange, or solid navy. */
  variant?: PlateVariant;
  /** Small letterspaced label printed top-centre, e.g. "Plate 02 / 06". */
  plateId?: string;
  /** Anchor id for in-page links. */
  id?: string;
  /** Drop the default full-height centring (for shorter list sections). */
  flush?: boolean;
  className?: string;
}

/** Crop marks in the four corners — the registration furniture of a print. */
function CropMarks() {
  return (
    <>
      <span className="fc-crop fc-crop--tl" aria-hidden="true" />
      <span className="fc-crop fc-crop--tr" aria-hidden="true" />
      <span className="fc-crop fc-crop--bl" aria-hidden="true" />
      <span className="fc-crop fc-crop--br" aria-hidden="true" />
    </>
  );
}

/**
 * A printed sheet: a full-bleed section in one of the three inks, complete with
 * corner crop marks, an optional plate id, and a halftone wash on the coloured
 * variants. The building block every First-Class page section is composed from.
 */
export function Plate({
  children,
  variant = "paper",
  plateId,
  id,
  flush = false,
  className,
}: PlateProps) {
  return (
    <section
      id={id}
      className={cn(
        "fc-plate",
        `fc-plate--${variant}`,
        flush && "fc-plate--flush",
        className,
      )}
    >
      <CropMarks />
      {plateId && <div className="fc-plate-id">{plateId}</div>}
      <div className="fc-plate-body">{children}</div>
    </section>
  );
}
