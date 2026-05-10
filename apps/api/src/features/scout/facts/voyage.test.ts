import { describe, expect, it, vi, type MockedFunction } from "vitest";
import {
  createVoyageClient,
  fromVectorLiteral,
  toVectorLiteral,
  VoyageError,
} from "./voyage.ts";

// `vi.fn(async () => ...)` infers Mock<[], Promise<Response>>, which makes
// `mock.calls[0][1]` a type error because the parameter tuple is empty.
// Wrapping with this typed helper preserves the fetch signature on the mock
// so call-site assertions on init/url type-check.
function mockFetch(
  impl: (...args: Parameters<typeof fetch>) => Promise<Response>,
): MockedFunction<typeof fetch> {
  return vi.fn(impl);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("voyage vector literal helpers", () => {
  it("round-trips a vector through the pgvector wire format", () => {
    const v = [0.1, -0.2, 1, 0];
    const lit = toVectorLiteral(v);
    expect(lit).toBe("[0.1,-0.2,1,0]");
    expect(fromVectorLiteral(lit)).toEqual(v);
  });
});

describe("voyage client", () => {
  it("embed sends the configured model + input_type and unmarshals the result", async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: [{ index: 0, embedding: [0.5, 0.5] }],
        }),
      ),
    );
    const client = createVoyageClient({
      apiKey: "k",
      embedModel: "voyage-4",
      fetchImpl,
    });

    const out = await client.embed("hello", "query");

    expect(out).toEqual([0.5, 0.5]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    if (!init) throw new Error("fetch called without init");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: "voyage-4",
      input: ["hello"],
      input_type: "query",
    });
    expect(init.headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("embedBatch reorders Voyage's index-keyed response back into request order", async () => {
    // Voyage doesn't guarantee response items come back in submission
    // order — the `index` field is the canonical mapping. Verify the
    // client honours it.
    const fetchImpl = mockFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: [
            { index: 2, embedding: [3] },
            { index: 0, embedding: [1] },
            { index: 1, embedding: [2] },
          ],
        }),
      ),
    );
    const client = createVoyageClient({ apiKey: "k", fetchImpl });

    const out = await client.embedBatch(["a", "b", "c"], "document");
    expect(out).toEqual([[1], [2], [3]]);
  });

  it("rerank returns relevance-ordered (index, score) pairs", async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.4 },
          ],
        }),
      ),
    );
    const client = createVoyageClient({
      apiKey: "k",
      rerankModel: "rerank-2.5",
      fetchImpl,
    });

    const out = await client.rerank("q", ["a", "b"], 2);

    expect(out).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
    const init = fetchImpl.mock.calls[0][1];
    if (!init) throw new Error("fetch called without init");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "rerank-2.5",
      query: "q",
      documents: ["a", "b"],
      top_k: 2,
    });
  });

  it("throws a sanitised VoyageError on non-2xx; raw provider body stays on .detail (not in .message)", async () => {
    // Voyage's 429 body includes billing copy + dashboard URLs we must
    // not surface to the model or user. The exposed Error.message is a
    // short vendor-neutral phrase; the raw body is preserved on .detail
    // for server-side logs only.
    const billingCopy =
      '{"detail":"You have not yet added your payment method ... https://dashboard.voyageai.com/"}';
    const fetchImpl = mockFetch(() =>
      Promise.resolve(new Response(billingCopy, { status: 429 })),
    );
    const client = createVoyageClient({ apiKey: "k", fetchImpl });

    let caught: unknown;
    try {
      await client.embed("hi", "query");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VoyageError);
    const e = caught as VoyageError;
    expect(e.status).toBe(429);
    expect(e.endpoint).toBe("embed");
    expect(e.message).not.toContain("dashboard.voyageai.com");
    expect(e.message).not.toContain("payment method");
    expect(e.message).toMatch(/rate-limited/i);
    expect(e.detail).toContain("dashboard.voyageai.com");
  });

  it("short-circuits empty inputs without hitting the wire", async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(jsonResponse({ data: [] })),
    );
    const client = createVoyageClient({ apiKey: "k", fetchImpl });

    expect(await client.embedBatch([], "document")).toEqual([]);
    expect(await client.rerank("q", [], 5)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
