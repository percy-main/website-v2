import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type {
  RecognitionSourcesExtractedPage,
  RecognitionSourcesSearchHit,
  RecognitionWebSearchClient,
} from "./recognition-sources.ts";

/**
 * Thin REST client for Tavily Search + Extract. No SDK dependency — the
 * surface is two POSTs with a Bearer token, and adding a third-party SDK
 * just for that isn't worth the supply-chain surface.
 *
 * Wired to Scout's recognition-source discovery tool — see ADR 042.
 */

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

const tavilyResultSchema = z.object({
  title: z.string().optional().default(""),
  url: z.url(),
  content: z.string().optional().default(""),
  score: z.number().optional(),
  published_date: z.string().optional(),
});

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultSchema),
});

const tavilyExtractResultSchema = z.object({
  url: z.string(),
  raw_content: z.string().optional().default(""),
  images: z.array(z.string()).optional(),
});

const tavilyExtractResponseSchema = z.object({
  results: z.array(tavilyExtractResultSchema),
  failed_results: z
    .array(z.object({ url: z.string(), error: z.string().optional() }))
    .optional()
    .default([]),
});

export class TavilyError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(opts: { status: number; detail: string }) {
    super(buildSanitisedMessage(opts.status));
    this.name = "TavilyError";
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

function buildSanitisedMessage(status: number): string {
  if (status === 429) {
    return "Web search is rate-limited right now. Try again in a moment.";
  }
  if (status === 401 || status === 403) {
    return "Web search is misconfigured (auth rejected). Ask the tech lead to check the Tavily API key.";
  }
  if (status >= 500) {
    return `Web search provider is having an issue (HTTP ${status}). Try again shortly.`;
  }
  return `Web search failed (HTTP ${status}).`;
}

export interface CreateTavilyClientOpts {
  apiKey: string;
  logger?: FastifyBaseLogger;
  /** Default `basic`. `advanced` returns better-quality but pricier results. */
  searchDepth?: "basic" | "advanced";
  /** Default `basic`. `advanced` is more reliable on JS-heavy pages (FB etc). */
  extractDepth?: "basic" | "advanced";
}

export function createTavilyClient(
  opts: CreateTavilyClientOpts,
): RecognitionWebSearchClient {
  const {
    apiKey,
    logger,
    searchDepth = "basic",
    extractDepth = "advanced",
  } = opts;

  async function post<T>(
    endpoint: string,
    label: "search" | "extract",
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      logger?.error(
        { status: res.status, detail: text.slice(0, 500) },
        `tavily: ${label} failed`,
      );
      throw new TavilyError({ status: res.status, detail: text });
    }
    const parsed = schema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success) {
      logger?.error(
        { issues: parsed.error.issues },
        `tavily: ${label} response did not match expected shape`,
      );
      throw new TavilyError({
        status: 502,
        detail: `unexpected response shape: ${parsed.error.message}`,
      });
    }
    return parsed.data;
  }

  return {
    async search(
      query: string,
      searchOpts?: { maxResults?: number },
    ): Promise<RecognitionSourcesSearchHit[]> {
      const data = await post(
        SEARCH_URL,
        "search",
        {
          query,
          search_depth: searchDepth,
          max_results: clampMaxResults(searchOpts?.maxResults),
        },
        tavilyResponseSchema,
      );
      return data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content || undefined,
        publishedAt: r.published_date,
      }));
    },

    async extract(urls: string[]): Promise<RecognitionSourcesExtractedPage[]> {
      if (urls.length === 0) return [];
      // Tavily caps the urls array at 20 per call.
      const batch = urls.slice(0, 20);
      const data = await post(
        EXTRACT_URL,
        "extract",
        {
          urls: batch,
          include_images: true,
          extract_depth: extractDepth,
        },
        tavilyExtractResponseSchema,
      );
      if (data.failed_results.length > 0) {
        logger?.warn(
          {
            failed: data.failed_results.map((f) => ({
              url: f.url,
              error: f.error,
            })),
          },
          "tavily: extract had per-URL failures",
        );
      }
      return data.results.map((r) => ({
        url: r.url,
        content: r.raw_content,
        images: r.images,
      }));
    },
  };
}

// Tavily caps max_results at 20 and rejects values outside [0, 20]. Cap
// here so callers can't accidentally drive a 400 with a too-wide request.
function clampMaxResults(requested: number | undefined): number {
  const n = requested ?? 5;
  if (n < 1) return 1;
  if (n > 20) return 20;
  return Math.floor(n);
}
