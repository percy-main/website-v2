/**
 * API client for the v2 backend.
 *
 * All data fetching in React components should use react-query hooks
 * that call these functions — never raw fetch in useEffect.
 *
 * Example usage:
 *
 * ```ts
 * import { api } from "@/lib/api";
 * import { useQuery } from "@tanstack/react-query";
 *
 * const { data } = useQuery({
 *   queryKey: ["members", "me"],
 *   queryFn: () => api.get("/members/me"),
 * });
 * ```
 */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const { headers: extraHeaders, ...restOptions } = options ?? {};
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders as Record<string, string>),
    },
    ...restOptions,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body != null ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
