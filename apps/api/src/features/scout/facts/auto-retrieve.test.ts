import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessage } from "ai";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { applyAutoRetrieval } from "./auto-retrieve.ts";
import type { VoyageClient } from "./voyage.ts";

// applyAutoRetrieval is the choke point that decides whether a turn gets
// fact memory. Its own SQL is exercised in the integration test; the
// pieces worth unit-testing here are the query construction (anaphora
// mitigation), the no-facts short-circuit, and the model-message
// mutation that lands the <known-facts> block in the right place.

function makeVoyageStub(opts: {
  embed?: number[];
  rerank?: Array<{ index: number; score: number }>;
}): VoyageClient {
  return {
    embed: vi.fn(() => Promise.resolve(opts.embed ?? [0, 0, 0])),
    embedBatch: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => opts.embed ?? [0, 0, 0])),
    ),
    rerank: vi.fn(() => Promise.resolve(opts.rerank ?? [])),
  };
}

function fakeDbReturning(rows: unknown[]): Kysely<DB> {
  // Just enough surface area for retrieveFacts: each executeQuery call
  // returns the same rows. Good enough for query-construction tests; the
  // integration test exercises the real SQL.
  return {
    executeQuery: vi.fn(() => Promise.resolve({ rows })),
  } as unknown as Kysely<DB>;
}

function userMsg(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

describe("applyAutoRetrieval", () => {
  it("returns input unchanged when no user text is present", async () => {
    const result = await applyAutoRetrieval(
      {
        db: fakeDbReturning([]),
        voyage: makeVoyageStub({}),
        userId: "u1",
      },
      [],
      [],
    );
    expect(result.factsCount).toBe(0);
    expect(result.factsBlock).toBe("");
  });

  it("returns input unchanged when retrieval returns zero facts", async () => {
    const modelMsgs: ModelMessage[] = [{ role: "user", content: "Hi" }];
    const result = await applyAutoRetrieval(
      {
        db: fakeDbReturning([]),
        voyage: makeVoyageStub({}),
        userId: "u1",
      },
      [userMsg("Hi")],
      modelMsgs,
    );

    expect(result.factsCount).toBe(0);
    expect(result.messages).toBe(modelMsgs); // identity, not just deep-equal
  });

  it("appends a <known-facts> text part to the last user message when facts are found", async () => {
    // Two candidate rows in the fake DB; reranker picks one of them.
    const db = fakeDbReturning([
      {
        id: "f1",
        content: "Mitford CC have no covers",
        tags: { team: "Mitford CC" },
        scope: "club",
        confidence: 4,
        created_at: new Date(),
      },
    ]);
    const voyage = makeVoyageStub({
      rerank: [{ index: 0, score: 0.92 }],
    });

    const modelMsgs: ModelMessage[] = [
      { role: "user", content: "Who do we play next?" },
      { role: "assistant", content: "Mitford on Saturday" },
      { role: "user", content: "How's their ground?" },
    ];

    const result = await applyAutoRetrieval(
      { db, voyage, userId: "u1" },
      [
        userMsg("Who do we play next?"),
        // assistant turn skipped by buildQuery
        userMsg("How's their ground?"),
      ],
      modelMsgs,
    );

    expect(result.factsCount).toBe(1);
    expect(result.factsBlock).toMatch(/<known-facts>/);
    expect(result.factsBlock).toContain("Mitford CC have no covers");

    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe("user");
    // The original "How's their ground?" string should still be there as
    // a text part, with the facts block as a separate appended text part.
    expect(Array.isArray(last.content)).toBe(true);
    const parts = last.content as Array<{ type: string; text: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "How's their ground?" });
    expect(parts[1].text).toContain("<known-facts>");
  });

  it("query is built from up to last 2 user messages + current (anaphora mitigation)", async () => {
    const embedSpy: VoyageClient["embed"] = vi.fn(() =>
      Promise.resolve([0, 0, 0]),
    );
    const voyage: VoyageClient = {
      embed: embedSpy,
      embedBatch: vi.fn(),
      rerank: vi.fn(() => Promise.resolve([])),
    };

    await applyAutoRetrieval(
      {
        db: fakeDbReturning([]),
        voyage,
        userId: "u1",
      },
      [
        userMsg("first question about Mitford"),
        userMsg("follow-up about their ground"),
        userMsg("what about them?"),
      ],
      [],
    );

    // Voyage embed should have been called once with a query that joins
    // the user texts so "what about them?" carries enough signal to
    // retrieve Mitford-tagged facts.
    const mock = vi.mocked(embedSpy);
    expect(mock).toHaveBeenCalledTimes(1);
    const [queryArg] = mock.mock.calls[0];
    expect(queryArg).toContain("Mitford");
    expect(queryArg).toContain("ground");
    expect(queryArg).toContain("what about them?");
  });
});
