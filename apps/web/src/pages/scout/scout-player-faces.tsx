import type { PlayerFacesSpec } from "@percy-main/shared";
import { useState } from "react";

const CONFIDENCE_CHIP: Record<
  PlayerFacesSpec["confidence"],
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

function FaceGrid({
  faces,
}: {
  faces: PlayerFacesSpec["sources"][number]["faces"];
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
      {faces.map((face) => (
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
  );
}

function SourceImage({
  source,
}: {
  source: PlayerFacesSpec["sources"][number];
}) {
  // Recognition images come from arbitrary public hosts (Facebook CDN, club
  // websites, news). Some 403 to direct hotlinks — fall back to a panel +
  // a link out so the captain can still click through to the original.
  const [broken, setBroken] = useState(false);
  const warnings = source.warnings ?? [];
  return (
    <div className="mt-3 rounded border border-stone-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-end">
        {source.sourceUrl ? (
          <a
            href={source.sourceUrl}
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
          src={source.imageUrl}
          alt={source.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-96 w-full rounded object-contain"
          onError={() => setBroken(true)}
        />
      )}
      {source.caption ? (
        <div className="mt-2 text-xs text-stone-500">{source.caption}</div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-amber-800">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ScoutPlayerFaces({ spec }: { spec: PlayerFacesSpec }) {
  const [open, setOpen] = useState(false);
  const chip = CONFIDENCE_CHIP[spec.confidence];

  // Flatten all face crops across sources into a single strip. The captain
  // is studying faces; which source each came from is one click away in
  // the expandable section below.
  const allFaces = spec.sources.flatMap((s) => s.faces);
  const totalFaces = allFaces.length;
  const sourceCount = spec.sources.length;

  return (
    <figure className="my-3 rounded border border-stone-200 bg-white p-3">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-stone-900">
          Possible photos of {spec.playerName}
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${chip.classes}`}
        >
          {chip.label}
        </span>
      </header>
      <div className="mb-2 text-xs text-stone-600">
        {totalFaces} face{totalFaces === 1 ? "" : "s"} detected across{" "}
        {sourceCount} source{sourceCount === 1 ? "" : "s"}
      </div>
      <FaceGrid faces={allFaces} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 text-xs font-medium text-stone-600 underline hover:text-stone-900"
      >
        {open
          ? `Hide source image${sourceCount === 1 ? "" : "s"}`
          : `Show source image${sourceCount === 1 ? "" : "s"} (${sourceCount})`}
      </button>
      {open ? (
        <div>
          {spec.sources.map((source) => (
            <SourceImage key={source.imageUrl} source={source} />
          ))}
        </div>
      ) : null}
    </figure>
  );
}
