import { OptimisedImage } from "@/components/optimised-image.js";
import { getPicture } from "@/lib/image-map.js";
import type { FC } from "react";

interface Props {
  /** Rendered side length of the rounded background panel, in CSS px. */
  width?: number;
  className?: string;
  loading?: "lazy" | "eager";
}

const picture = getPicture("/images/imbuzai.png");

/**
 * The ImbuzAI mascot — Percy Main's AI cricket analyst, named for a
 * portmanteau of imbuzi (Zulu for goat — cricketing GOAT) and AI. The
 * asset has a transparent background; we sit it on a rounded square
 * panel in the club's primary forest green so the gold silhouette pops.
 */
export const ImbuzaiMascot: FC<Props> = ({
  width = 64,
  className = "",
  loading = "lazy",
}) => {
  if (!picture) return null;
  return (
    <span
      className={`bg-primary inline-flex items-center justify-center overflow-hidden rounded-2xl ${className}`}
      style={{ width, height: width, padding: Math.round(width * 0.08) }}
    >
      <OptimisedImage
        picture={picture}
        alt="ImbuzAI mascot"
        loading={loading}
        sizes={`${width}px`}
        className="h-full w-full object-contain"
      />
    </span>
  );
};
