import {
  eventMetadataSchema,
  pageMetadataSchema,
  personMetadataSchema,
} from "@percy-main/shared/content";
import { gameHeadMetadataSchema } from "./game-meta.js";

// Per-page <head> block for prerendered documents: title, description,
// canonical, OG/Twitter cards and JSON-LD. Pure string assembly - no DOM,
// no fetching - so it unit-tests exhaustively. The output replaces the
// generic block between the pm-meta markers in index.html
// (assemble-document.ts).

const SITE_NAME = "Percy Main Community Sports Club";
const DEFAULT_DESCRIPTION =
  "Percy Main Community Sports Club — football, cricket, and community sports in North Shields. Find fixtures, results, news, and membership info.";
const DEFAULT_OG_IMAGE_PATH = "/images/og-default.png";

/** Public content kinds the prerenderer snapshots (game reports render
 * on their game page, not standalone). */
export type PrerenderKind =
  "page" | "news" | "event" | "person" | "game" | "calendar-month";

export interface HeadInput {
  kind: PrerenderKind;
  /** Public URL path, e.g. `/club/history` or `/news/article/foo`. */
  url: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  /** BlockNote document; scanned for a lead image on news articles. */
  body?: unknown;
  publishedAt?: string;
  updatedAt?: string;
  /**
   * Explicit og:image override (absolute URL) - game pages point at the
   * API's scorecard PNG endpoint. Keeps this module pure: the caller
   * resolves the API origin.
   */
  ogImageUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `</script>`-safe JSON for inline ld+json. */
function ldJsonSerialize(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function meta(attr: "property" | "name", key: string, value: string): string {
  return `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
}

function absolutize(src: string, origin: string): string {
  return src.startsWith("/") ? `${origin}${src}` : src;
}

/**
 * Lead image for a news article: the first contentImage block's picture
 * fallback (or plain src), or the first photo of the first photoGallery
 * block - whichever block comes first. Walks top-level blocks only - a
 * lead image nested inside another block isn't a lead image.
 */
function findLeadImage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const blocks = Array.isArray(body)
    ? body
    : (body as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const type = (block as { type?: unknown }).type;
    const props = (block as { props?: Record<string, unknown> }).props ?? {};
    if (type === "contentImage") {
      if (typeof props.picture === "string" && props.picture) {
        try {
          const picture = JSON.parse(props.picture) as {
            img?: { src?: unknown };
          };
          if (typeof picture.img?.src === "string") return picture.img.src;
        } catch {
          // fall through to plain src
        }
      }
      if (typeof props.src === "string" && props.src) return props.src;
    }
    if (type === "photoGallery") {
      if (typeof props.images === "string" && props.images) {
        try {
          const images = JSON.parse(props.images) as Array<{
            picture?: { img?: { src?: unknown } };
          }>;
          const first = Array.isArray(images) ? images[0] : undefined;
          if (typeof first?.picture?.img?.src === "string") {
            return first.picture.img.src;
          }
        } catch {
          // a malformed gallery is never a lead image
        }
      }
    }
  }
  return undefined;
}

function resolveOgImage(input: HeadInput, origin: string): string {
  if (input.ogImageUrl) return input.ogImageUrl;
  if (input.kind === "person") {
    const parsed = personMetadataSchema.safeParse(input.metadata);
    if (parsed.success && parsed.data.photo) {
      return absolutize(parsed.data.photo.img.src, origin);
    }
  }
  if (input.kind === "news") {
    const lead = findLeadImage(input.body);
    if (lead) return absolutize(lead, origin);
  }
  return `${origin}${DEFAULT_OG_IMAGE_PATH}`;
}

function buildLdJson(input: HeadInput, origin: string): unknown {
  const pageUrl = `${origin}${input.url}`;
  switch (input.kind) {
    case "page": {
      const parsed = pageMetadataSchema.safeParse(input.metadata);
      // metadata.ldjson is author-supplied structured data, stored since
      // the MDX pipeline but never rendered until now (#241 in
      // content-page.tsx documents the old parity stance).
      if (parsed.success && parsed.data.ldjson) return parsed.data.ldjson;
      return undefined;
    }
    case "news": {
      const image = resolveOgImage(input, origin);
      return {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
        ...(input.updatedAt ? { dateModified: input.updatedAt } : {}),
        image: [image],
        mainEntityOfPage: pageUrl,
        publisher: { "@type": "Organization", name: SITE_NAME },
      };
    }
    case "event": {
      const parsed = eventMetadataSchema.safeParse(input.metadata);
      if (!parsed.success) return undefined;
      const { when, finish, location } = parsed.data;
      return {
        "@context": "https://schema.org",
        "@type": "Event",
        name: input.title,
        ...(input.description ? { description: input.description } : {}),
        startDate: when,
        ...(finish ? { endDate: finish } : {}),
        ...(location
          ? {
              location: {
                "@type": "Place",
                name: location.name,
                address: {
                  "@type": "PostalAddress",
                  streetAddress: location.street,
                  addressLocality: location.city,
                  postalCode: location.postcode,
                },
              },
            }
          : {}),
        url: pageUrl,
      };
    }
    case "person": {
      return {
        "@context": "https://schema.org",
        "@type": "Person",
        name: input.title,
        ...(input.description ? { description: input.description } : {}),
        image: resolveOgImage(input, origin),
        url: pageUrl,
      };
    }
    case "game": {
      const parsed = gameHeadMetadataSchema.safeParse(input.metadata);
      if (!parsed.success) return undefined;
      const { when, homeTeam, awayTeam, locationName } = parsed.data;
      return {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(when ? { startDate: when } : {}),
        sport: "Cricket",
        homeTeam: { "@type": "SportsTeam", name: homeTeam },
        awayTeam: { "@type": "SportsTeam", name: awayTeam },
        ...(locationName
          ? { location: { "@type": "Place", name: locationName } }
          : {}),
        organizer: { "@type": "SportsOrganization", name: SITE_NAME },
        url: pageUrl,
      };
    }
    case "calendar-month":
      return undefined;
  }
}

function ogType(kind: PrerenderKind): string {
  if (kind === "news") return "article";
  if (kind === "person") return "profile";
  return "website";
}

/**
 * The full replacement for index.html's pm-meta block. `origin` is the
 * canonical public origin (no trailing slash).
 */
export function buildHead(
  input: HeadInput,
  origin = "https://www.percymain.org",
): string {
  const title = `${input.title} | ${SITE_NAME}`;
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const pageUrl = `${origin}${input.url}`;
  const image = resolveOgImage(input, origin);
  const isDefaultImage = image === `${origin}${DEFAULT_OG_IMAGE_PATH}`;

  const lines: string[] = [
    `<title>${escapeHtml(title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    meta("property", "og:title", input.title),
    meta("property", "og:description", description),
    meta("property", "og:url", pageUrl),
    meta("property", "og:image", image),
    meta("property", "og:type", ogType(input.kind)),
    meta("property", "og:site_name", SITE_NAME),
  ];

  if (input.kind === "news") {
    if (input.publishedAt) {
      lines.push(meta("property", "article:published_time", input.publishedAt));
    }
    if (input.updatedAt) {
      lines.push(meta("property", "article:modified_time", input.updatedAt));
    }
  }

  lines.push(
    meta(
      "name",
      "twitter:card",
      isDefaultImage ? "summary" : "summary_large_image",
    ),
    meta("name", "twitter:title", input.title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
  );

  const ldJson = buildLdJson(input, origin);
  if (ldJson !== undefined) {
    lines.push(
      `<script type="application/ld+json">${ldJsonSerialize(ldJson)}</script>`,
    );
  }

  return lines.join("\n    ");
}
