import {
  eventMetadataSchema,
  newsMetadataSchema,
  pageMetadataSchema,
  type EventMetadata,
  type NewsMetadata,
  type PageMetadata,
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

const detailStaleTime = (query: { state: { data: unknown } }) =>
  query.state.data === null ? NOT_FOUND_STALE_TIME : STALE_TIME;

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
        // Not published in the DB - callers fall back to the bundled MDX.
        if ((err as { status?: number }).status === 404) return null;
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
