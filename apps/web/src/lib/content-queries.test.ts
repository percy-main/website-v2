import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// The queryFn's terminal-state mapping (404 -> null, 410 -> PAGE_GONE,
// anything else -> error) is what keeps an API incident from rendering
// as a 404 and spiking the route_not_found metric - lock it down at the
// lib level. The HTTP layer is mocked; callApi's throw shape (an Error
// carrying `status`) is simulated directly.
const callApi = vi.hoisted(() => vi.fn());
vi.mock("./api-client.js", () => ({
  api: { GET: vi.fn() },
  callApi,
}));

import {
  isPageGone,
  PAGE_GONE,
  pageByPathQueryOptions,
} from "./content-queries.js";

const apiError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

function runQueryFn(path: string) {
  const opts = pageByPathQueryOptions(path);
  const { queryFn } = opts;
  if (typeof queryFn !== "function") {
    throw new Error("expected pageByPathQueryOptions to define a queryFn");
  }
  return queryFn({
    client: new QueryClient(),
    queryKey: opts.queryKey,
    signal: new AbortController().signal,
    meta: undefined,
  });
}

describe("pageByPathQueryOptions queryFn", () => {
  it("returns the page payload on success", async () => {
    const payload = { id: "1", title: "Club" };
    callApi.mockResolvedValueOnce(payload);
    await expect(runQueryFn("/club")).resolves.toBe(payload);
  });

  it("maps 404 to null - never published, static fallback applies", async () => {
    callApi.mockRejectedValueOnce(apiError(404));
    await expect(runQueryFn("/club")).resolves.toBeNull();
  });

  it("maps 410 to the PAGE_GONE sentinel - takedown, no fallback", async () => {
    callApi.mockRejectedValueOnce(apiError(410));
    await expect(runQueryFn("/club")).resolves.toBe(PAGE_GONE);
  });

  it("rethrows other failures so callers see an error, not a miss", async () => {
    callApi.mockRejectedValueOnce(apiError(500));
    await expect(runQueryFn("/club")).rejects.toThrow("HTTP 500");
  });
});

describe("isPageGone", () => {
  it("matches only the gone sentinel shape", () => {
    expect(isPageGone(PAGE_GONE)).toBe(true);
    expect(isPageGone(null)).toBe(false);
    expect(isPageGone(undefined)).toBe(false);
    expect(isPageGone({ id: "1", title: "Club" })).toBe(false);
  });
});
