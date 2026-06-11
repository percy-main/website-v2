import {
  eventMetadataSchema,
  newsMetadataSchema,
  pageMetadataSchema,
  personMetadataSchema,
  type EventMetadata,
  type NewsMetadata,
  type PageMetadata,
  type PersonMetadata,
} from "@percy-main/shared/content";
import { queryOptions } from "@tanstack/react-query";
import { api, callApi } from "./api-client.js";

// Shared query definitions for public DB-backed content (#489). List pages
// prefetch with exactly the options the detail pages read, so a hover or
// viewport prefetch always lands in the cache entry the navigation uses -
// keeping them in one module stops the two sides drifting apart.

const STALE_TIME = 5 * 60 * 1000;

// Scheduled publishing boundary: a null detail result means "not
// published yet", and a scheduled item flips to published the instant
// its published_at passes (server-side DB clock - no deploy, no manual
// action). A 404-as-null cached for the full 5 minutes would keep an SPA
// visitor on the missing/fallback state past that moment, so misses go
// stale fast; real content keeps the full window. Lists keep their flat
// 5 minutes - bounded staleness there is accepted.
const NOT_FOUND_STALE_TIME = 30 * 1000;

/**
 * Sentinel for a 410 Gone page: an ever-live page deliberately taken
 * down (unpublished or archived). Distinct from the 404 `null` so
 * callers can suppress the static fallback - a takedown must not
 * resurrect the bundled MDX version of the page.
 */
export const PAGE_GONE = { gone: true } as const;
export type PageGone = typeof PAGE_GONE;

export function isPageGone(value: unknown): value is PageGone {
  return typeof value === "object" && value !== null && "gone" in value;
}

// Both miss states go stale fast: `null` so a scheduled publish shows up
// promptly (see above), PAGE_GONE so reverting a mistaken takedown
// propagates just as quickly.
const detailStaleTime = (query: { state: { data: unknown } }) =>
  query.state.data === null || isPageGone(query.state.data)
    ? NOT_FOUND_STALE_TIME
    : STALE_TIME;

export const NEWS_PAGE_SIZE = 5;

export function newsArticleQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ["content", "news", slug],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET("/api/content/{kind}/{slug}", {
            params: { path: { kind: "news", slug } },
          }),
        );
      } catch (err) {
        // Not published in the DB - callers fall back to the bundled MDX.
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    staleTime: detailStaleTime,
    retry: false,
  });
}

export function eventQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ["content", "event", slug],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET("/api/content/{kind}/{slug}", {
            params: { path: { kind: "event", slug } },
          }),
        );
      } catch (err) {
        // Not published in the DB - callers fall back to the bundled MDX.
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    staleTime: detailStaleTime,
    retry: false,
  });
}

export function personQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ["content", "person", slug],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET("/api/content/{kind}/{slug}", {
            params: { path: { kind: "person", slug } },
          }),
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        // Never published in the DB - callers fall back to the bundled
        // MDX.
        if (status === 404) return null;
        // Ever-live profile taken down (unpublished/archived). A
        // terminal data state, not an error: callers render "not found"
        // without the static fallback - a takedown must not resurrect
        // the bundled MDX profile (same sentinel as pages).
        if (status === 410) return PAGE_GONE;
        throw err;
      }
    },
    staleTime: detailStaleTime,
    retry: false,
  });
}

export function pageByPathQueryOptions(path: string) {
  return queryOptions({
    queryKey: ["content", "page", path],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET("/api/content/page/by-path", {
            params: { query: { path } },
          }),
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        // Never published in the DB - callers fall back to the bundled
        // MDX.
        if (status === 404) return null;
        // Ever-live page taken down (unpublished/archived). A terminal
        // data state, not an error: callers render "not found" without
        // the static fallback and without a route_not_found report.
        if (status === 410) return PAGE_GONE;
        // Anything else (5xx, network) surfaces as a query error so
        // callers can tell an API incident apart from a real miss.
        throw err;
      }
    },
    staleTime: detailStaleTime,
    retry: false,
  });
}

// The nav list backs the site header and every content-page sidebar, so
// it is cached aggressively: the shared STALE_TIME bounds visible
// staleness, while a generous gcTime keeps the last good list around for
// instant SPA navigations long after the query unmounts. Retries stay at
// the react-query default (like the list queries above) - consumers
// degrade to the static-only nav while the query is pending or failed,
// so nav never breaks on API trouble.
const NAV_GC_TIME = 24 * 60 * 60 * 1000;

export function navQueryOptions() {
  return queryOptions({
    queryKey: ["content", "nav"],
    queryFn: () => callApi(api.GET("/api/content/nav")),
    staleTime: STALE_TIME,
    gcTime: NAV_GC_TIME,
  });
}

export function newsListQueryOptions(params: { tag?: string; page: number }) {
  return queryOptions({
    queryKey: ["content", "news-list", params.tag ?? null, params.page],
    queryFn: () =>
      callApi(
        api.GET("/api/content/news", {
          params: {
            query: {
              tag: params.tag,
              page: params.page,
              pageSize: NEWS_PAGE_SIZE,
            },
          },
        }),
      ),
    staleTime: STALE_TIME,
  });
}

export function eventsListQueryOptions() {
  return queryOptions({
    queryKey: ["content", "events-list"],
    queryFn: () => callApi(api.GET("/api/content/events")),
    staleTime: STALE_TIME,
  });
}

// One cached roster backs every person card, grid and picker - resolving
// cards per-slug would be an N+1 each time a page renders a person grid.
export function peopleListQueryOptions() {
  return queryOptions({
    queryKey: ["content", "people-list"],
    queryFn: () => callApi(api.GET("/api/content/people")),
    staleTime: STALE_TIME,
  });
}

// The generated OpenAPI types carry metadata as a loose record; the shared
// Zod schemas are the source of truth for each kind's shape, so narrow
// through them rather than asserting.

export function parseNewsMetadata(metadata: unknown): NewsMetadata | undefined {
  const parsed = newsMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : undefined;
}

export function parseEventMetadata(
  metadata: unknown,
): EventMetadata | undefined {
  const parsed = eventMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : undefined;
}

export function parsePageMetadata(metadata: unknown): PageMetadata | undefined {
  const parsed = pageMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : undefined;
}

export function parsePersonMetadata(
  metadata: unknown,
): PersonMetadata | undefined {
  const parsed = personMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : undefined;
}
