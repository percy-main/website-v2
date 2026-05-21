/**
 * Typed API client generated from the OpenAPI spec.
 *
 * Usage with react-query:
 *
 * ```ts
 * import { api, callApi } from "@/lib/api-client";
 *
 * const { data } = useQuery({
 *   queryKey: ["leaderboard"],
 *   queryFn: () => callApi(api.GET("/api/leaderboard", {
 *     params: { query: { game: "be-the-keeper", limit: 25 } },
 *   })),
 * });
 * // data is fully typed — no manual interfaces needed
 * ```
 */

import createClient from "openapi-fetch";
import type { paths } from "./api.gen.js";

/**
 * Pull a human-readable message out of openapi-fetch's `error` slot. The
 * Fastify error handler in apps/api/src/app.ts replies with
 * `{ error: <message> }`, but the legacy shape `{ message: <...> }` shows
 * up too (e.g. better-auth, validation plugins). Bare strings are sent by
 * a few hand-rolled error paths. Anything else falls back to the HTTP
 * status text so the user at least sees something useful.
 */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    if ("error" in error && typeof error.error === "string") return error.error;
    if ("message" in error) return String(error.message);
  }
  return fallback;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export const api = createClient<paths>({
  baseUrl: API_BASE.replace(/\/api$/, ""),
  credentials: "include",
});

/**
 * Calls an openapi-fetch method, throws on error, returns typed data.
 *
 * ```ts
 * queryFn: () => callApi(api.GET("/api/leaderboard"))
 * ```
 */
export async function callApi<T>(
  response: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response: res } = await response;
  if (error !== undefined) {
    throw new ApiError(res.status, extractErrorMessage(error, res.statusText));
  }
  return data as T;
}
