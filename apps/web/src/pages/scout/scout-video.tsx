import type { VideoSpec } from "@percy-main/shared";

// YouTube nocookie embed: same player, no third-party tracking until the user
// hits play. ?start=N seeks to N seconds before playing; ?end=N stops at N
// (inclusive of start). rel=0 keeps the post-roll suggestions to the same
// channel, modestbranding=1 hides the YouTube logo while playing.
const EMBED_BASE = "https://www.youtube-nocookie.com/embed";

function buildSrc(spec: VideoSpec): string {
  const params = new URLSearchParams();
  if (spec.startSeconds !== undefined) {
    params.set("start", String(spec.startSeconds));
  }
  if (spec.endSeconds !== undefined) {
    params.set("end", String(spec.endSeconds));
  }
  params.set("rel", "0");
  params.set("modestbranding", "1");
  const qs = params.toString();
  return `${EMBED_BASE}/${spec.videoId}${qs ? `?${qs}` : ""}`;
}

export function ScoutVideo({ spec }: { spec: VideoSpec }) {
  const src = buildSrc(spec);
  return (
    <figure className="my-3 rounded border border-gray-200 bg-white p-3">
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-gray-900">
          {spec.title}
        </figcaption>
      ) : null}
      <div className="relative w-full overflow-hidden rounded bg-black pb-[56.25%]">
        <iframe
          src={src}
          title={spec.title ?? "Match highlight"}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {spec.caption ? (
        <figcaption className="mt-2 text-xs text-gray-500">
          {spec.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
