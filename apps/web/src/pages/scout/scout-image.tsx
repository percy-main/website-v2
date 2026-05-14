import type { ImageSpec } from "@percy-main/shared";
import { useState } from "react";

const CONFIDENCE_CHIP: Record<
  NonNullable<ImageSpec["confidence"]>,
  { label: string; classes: string }
> = {
  high: {
    label: "High confidence",
    classes: "bg-emerald-100 text-emerald-900",
  },
  medium: {
    label: "Medium confidence",
    classes: "bg-amber-100 text-amber-900",
  },
  low: {
    label: "Low confidence",
    classes: "bg-stone-200 text-stone-900",
  },
};

export function ScoutImage({ spec }: { spec: ImageSpec }) {
  // Recognition-source images come from arbitrary public hosts (Facebook
  // CDN, club websites, news sites). Some will be auth-gated, signed-URL
  // expired, or hotlink-blocked — fall back to a "source unavailable"
  // panel + a link to the source page so the captain can still click
  // through. We don't try to proxy or rehost.
  const [broken, setBroken] = useState(false);
  const chip = spec.confidence ? CONFIDENCE_CHIP[spec.confidence] : null;
  const warnings = spec.warnings ?? [];

  return (
    <figure className="my-3 rounded border border-stone-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        {chip ? (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${chip.classes}`}
          >
            {chip.label}
          </span>
        ) : (
          <span />
        )}
        {spec.sourceUrl ? (
          <a
            href={spec.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-500 underline hover:text-stone-700"
          >
            View source
          </a>
        ) : null}
      </div>
      {broken ? (
        <div className="flex items-center justify-center rounded bg-stone-50 p-6 text-center text-sm text-stone-500">
          Couldn&rsquo;t load this image directly. Open the source link above to
          view it on the original page.
        </div>
      ) : (
        <img
          src={spec.imageUrl}
          alt={spec.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-96 w-full rounded object-contain"
          onError={() => setBroken(true)}
        />
      )}
      {spec.caption ? (
        <figcaption className="mt-2 text-xs text-stone-500">
          {spec.caption}
        </figcaption>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-amber-800">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
      {spec.faces && spec.faces.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-stone-700">
            {spec.faces.length} face{spec.faces.length === 1 ? "" : "s"}{" "}
            detected
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {spec.faces.map((face) => (
              <a
                key={face.url}
                href={face.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded border border-stone-200 hover:border-stone-400"
                aria-label="Open detected face crop"
              >
                <img
                  src={face.url}
                  alt="Detected face"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-square w-full object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </figure>
  );
}
