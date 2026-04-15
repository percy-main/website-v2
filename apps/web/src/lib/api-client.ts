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
    throw new ApiError(
      res.status,
      typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : res.statusText,
    );
  }
  return data as T;
}
