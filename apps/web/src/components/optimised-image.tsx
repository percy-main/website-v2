import type { FC } from "react";

/**
 * Shape returned by vite-imagetools `?as=picture` imports.
 * `sources` maps format (e.g. "avif", "webp") to a pre-built srcset string.
 * `img` is the largest fallback image metadata.
 */
export interface PictureSource {
  sources: Record<string, string>;
  img: { src: string; w: number; h: number };
}

interface Props {
  picture: PictureSource;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  sizes?: string;
  width?: number;
  height?: number;
}

/**
 * Renders a `<picture>` element from vite-imagetools `?as=picture` output.
 * Provides AVIF, WebP sources with srcset and a fallback `<img>`.
 */
export const OptimisedImage: FC<Props> = ({
  picture,
  alt,
  className,
  loading = "lazy",
  sizes = "100vw",
  width,
  height,
}) => {
  const { sources, img } = picture;

  // Preferred format order: avif first, then webp, then everything else
  const formatOrder = ["avif", "webp"];
  const orderedFormats = [
    ...formatOrder.filter((f) => f in sources),
    ...Object.keys(sources).filter((f) => !formatOrder.includes(f)),
  ];

  return (
    <picture>
      {orderedFormats.map((format) => (
        <source
          key={format}
          type={`image/${format}`}
          srcSet={sources[format]}
          sizes={sizes}
        />
      ))}
      <img
        src={img.src}
        width={width ?? img.w}
        height={height ?? img.h}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
      />
    </picture>
  );
};
