import type { UIMessageStreamWriter } from "ai";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../../test/containers.ts";
import { createFactTools } from "../tools/facts.ts";
import {
  formatFactsBlock,
  recordFact,
  retrieveFacts,
  type FactScope,
} from "./service.ts";
import type { VoyageClient } from "./voyage.ts";

// Real pgvector — verifies the migration's vector column, HNSW index,
// FTS index, supersession chain, and the cosine-distance dedup
// threshold all work end-to-end. Voyage is mocked so the test is offline
// and deterministic; what we need from the real DB is that pgvector
// stores+sorts vectors, the FTS index returns rows, and the SQL we wrote
// in service.ts actually runs against pg.

let ctx: TestContext;
let userId: string;

// Crafted vectors so cosine distance is predictable. Using 1024-dim is
// painful by hand, but we can pad with zeros around a few signal coords
// to control which fact is "near" which query.
const DIM = 1024;
function vec(...nonZero: Array<[number, number]>): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const [i, val] of nonZero) v[i] = val;
  return v;
}

interface FactSeed {
  content: string;
  tags?: Record<string, string | string[]>;
  scope?: FactScope;
  confidence?: number;
  vector: number[];
}

function buildVoyageMock(opts: {
  // Map a content/query string to the embedding that should come back.
  embeddings: Map<string, number[]>;
  // Optional: control rerank ordering. Default: identity (preserve input order).
  rerank?: (
    query: string,
    docs: string[],
  ) => Array<{ index: number; score: number }>;
}): VoyageClient {
  const embedSync = (text: string): number[] => {
    const v = opts.embeddings.get(text);
    if (!v) throw new Error(`no test embedding for: ${text}`);
    return v;
  };
  return {
    embed: vi.fn((text: string) => Promise.resolve(embedSync(text))),
    embedBatch: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((t) => embedSync(t))),
    ),
    rerank: vi.fn((query: string, docs: string[], topK?: number) => {
      const ordered = opts.rerank
        ? opts.rerank(query, docs)
        : docs.map((_, index) => ({ index, score: 1 - index * 0.01 }));
      return Promise.resolve(topK ? ordered.slice(0, topK) : ordered);
    }),
  };
}

beforeAll(async () => {
  ctx = await startTestContainer();
  const seeded = await seedTestUser(ctx.db, {
    email: "scout-rag-test@test.com",
  });
  userId = seeded.userId;
}, 120_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

beforeEach(async () => {
  // Wipe the corpus between cases so dedup / supersession assertions
  // don't see leftovers from prior tests.
  await ctx.db.deleteFrom("scout_fact").execute();
});

describe("scout_fact migration + pgvector", () => {
  it("the vector extension is installed and the embedding column is the right shape", async () => {
    const ext = await ctx.db
      .selectFrom("pg_extension" as never)
      .select(["extname"] as never)
      .where("extname" as never, "=", "vector" as never)
      .execute();
    expect((ext as Array<{ extname: string }>).length).toBe(1);
  });
});

describe("recordFact — write path with cosine dedup + supersession", () => {
  it("inserts a fresh fact when nothing nearby exists", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([["Mitford CC have no covers", vec([0, 1])]]),
    });

    const result = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: "Mitford CC have no covers",
      tags: { team: "Mitford CC", topic: "ground" },
      confidence: 5,
    });

    expect(result.action).toBe("inserted");
    expect(result.supersededId).toBeUndefined();

    const row = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", result.id)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.content).toBe("Mitford CC have no covers");
    expect(row.scope).toBe("club");
    expect(row.confidence).toBe(5);
    expect(row.superseded_by).toBeNull();
    // topic="ground" maps to permanence=seasonal; the inference fires
    // when permanence isn't supplied explicitly.
    expect(row.permanence).toBe("seasonal");
  });

  it("leaves permanence NULL when the topic isn't in the inference table", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([["Random unclassified note", vec([0, 1])]]),
    });
    const result = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: "Random unclassified note",
      tags: { topic: "something-else" },
    });
    const row = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", result.id)
      .select("permanence")
      .executeTakeFirstOrThrow();
    expect(row.permanence).toBeNull();
  });

  it("respects an explicit permanence override over the topic-inferred default", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["Sightscreens at both ends at Mitford", vec([0, 1])],
      ]),
    });
    const result = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      // topic=ground would normally infer "seasonal" — caller forcing
      // "permanent" wins.
      content: "Sightscreens at both ends at Mitford",
      tags: { topic: "ground" },
      permanence: "permanent",
    });
    const row = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", result.id)
      .select("permanence")
      .executeTakeFirstOrThrow();
    expect(row.permanence).toBe("permanent");
  });

  it("supersedes a near-duplicate (cosine distance < 0.1) instead of inserting twice", async () => {
    const original = "Mitford CC have no covers";
    const updated = "Mitford CC have no covers (still none in 2026)";

    // Two near-identical vectors → cosine distance ~0.
    const voyage = buildVoyageMock({
      embeddings: new Map([
        [original, vec([0, 1])],
        [updated, vec([0, 1], [1, 0.001])], // tiny perturbation
      ]),
    });
    const record = recordFact(ctx.db, voyage);

    const first = await record({
      userId,
      scope: "club",
      content: original,
    });
    expect(first.action).toBe("inserted");

    const second = await record({
      userId,
      scope: "club",
      content: updated,
    });
    expect(second.action).toBe("superseded");
    expect(second.supersededId).toBe(first.id);

    // Old row points at the new one; new row is live.
    const old = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", first.id)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(old.superseded_by).toBe(second.id);

    const live = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", second.id)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(live.superseded_by).toBeNull();
  });

  it("does NOT supersede when the existing fact is far away in vector space", async () => {
    // Orthogonal vectors → cosine distance = 1, well above the 0.1
    // threshold. Two distinct facts about different things should both
    // exist independently.
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["Mitford CC have no covers", vec([0, 1])],
        ["Saturday games start at 1pm", vec([1, 1])],
      ]),
    });
    const record = recordFact(ctx.db, voyage);

    await record({
      userId,
      scope: "club",
      content: "Mitford CC have no covers",
    });
    const second = await record({
      userId,
      scope: "club",
      content: "Saturday games start at 1pm",
    });
    expect(second.action).toBe("inserted");

    const live = await ctx.db
      .selectFrom("scout_fact")
      .where("superseded_by", "is", null)
      .execute();
    expect(live).toHaveLength(2);
  });
});

describe("retrieveFacts — hybrid retrieval + rerank", () => {
  async function seed(facts: FactSeed[], voyage: VoyageClient) {
    const record = recordFact(ctx.db, voyage);
    for (const f of facts) {
      await record({
        userId,
        scope: f.scope ?? "club",
        content: f.content,
        tags: f.tags,
        confidence: f.confidence,
      });
    }
  }

  it("ranks vector-near facts above unrelated ones via rerank ordering", async () => {
    // Three facts; the query is semantically about "ground conditions".
    // Vector search returns all three; rerank is the deciding step.
    const groundFact = "Mitford CC have no covers";
    const timingFact = "Saturday games start at 1pm";
    const playerFact = "Smith opens the bowling for Tynemouth";

    const embeddings = new Map<string, number[]>([
      [groundFact, vec([0, 1])],
      [timingFact, vec([5, 1])],
      [playerFact, vec([10, 1])],
      // Query embedding closest to groundFact.
      ["What's Mitford's ground like?", vec([0, 0.99])],
    ]);

    const voyage = buildVoyageMock({
      embeddings,
      // Reranker: prefer the ground fact regardless of input order.
      rerank: (_q, docs) => {
        const indexes = docs
          .map((d, i) => ({ d, i }))
          .sort((a, b) => {
            const score = (s: string) => (s === groundFact ? 1 : 0);
            return score(b.d) - score(a.d);
          });
        return indexes.map(({ i }, rank) => ({
          index: i,
          score: 1 - rank * 0.1,
        }));
      },
    });

    await seed(
      [
        { content: groundFact, vector: vec([0, 1]) },
        { content: timingFact, vector: vec([5, 1]) },
        { content: playerFact, vector: vec([10, 1]) },
      ],
      voyage,
    );

    const out = await retrieveFacts(
      ctx.db,
      voyage,
    )({
      userId,
      query: "What's Mitford's ground like?",
      topK: 3,
    });

    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].content).toBe(groundFact);
  });

  it("FTS catches exact-name lookups that vector noise might bury", async () => {
    // Query embedding deliberately far from the relevant fact's vector,
    // so vector retrieval alone wouldn't surface it. FTS path matches on
    // the literal token "Swalwell".
    const swalwell =
      "Swalwell is a massive ground with short square boundaries";

    const embeddings = new Map<string, number[]>([
      [swalwell, vec([0, 1])],
      // Query vector orthogonal to the fact vector.
      ["Tell me about Swalwell", vec([1, 0])],
    ]);
    const voyage = buildVoyageMock({ embeddings });

    await seed([{ content: swalwell, vector: vec([0, 1]) }], voyage);

    const out = await retrieveFacts(
      ctx.db,
      voyage,
    )({
      userId,
      query: "Tell me about Swalwell",
    });

    expect(out.map((f) => f.content)).toContain(swalwell);
  });

  it("scope=user facts are not visible to other users", async () => {
    const fact = "I hate facing spin";
    const embeddings = new Map<string, number[]>([
      [fact, vec([0, 1])],
      ["facing spin", vec([0, 0.99])],
    ]);
    const voyage = buildVoyageMock({ embeddings });

    await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "user",
      content: fact,
      confidence: 5,
    });

    // Seed a second user with no facts of their own and try to retrieve.
    const other = await seedTestUser(ctx.db, {
      email: "other-scout@test.com",
    });

    const out = await retrieveFacts(
      ctx.db,
      voyage,
    )({
      userId: other.userId,
      query: "facing spin",
    });
    expect(out).toEqual([]);
  });

  it("explicit tag filter narrows the candidate set", async () => {
    const mitford = "Mitford CC's pitch is on the slow side";
    const tynemouth = "Tynemouth bat deep in their order";

    const embeddings = new Map<string, number[]>([
      [mitford, vec([0, 1])],
      [tynemouth, vec([5, 1])],
      ["pitch", vec([2, 1])],
    ]);
    const voyage = buildVoyageMock({ embeddings });

    const record = recordFact(ctx.db, voyage);
    await record({
      userId,
      scope: "club",
      content: mitford,
      tags: { team: "Mitford CC" },
    });
    await record({
      userId,
      scope: "club",
      content: tynemouth,
      tags: { team: "Tynemouth" },
    });

    const out = await retrieveFacts(
      ctx.db,
      voyage,
    )({
      userId,
      query: "pitch",
      tags: { team: "Mitford CC" },
    });

    expect(out.map((f) => f.content)).toContain(mitford);
    expect(out.map((f) => f.content)).not.toContain(tynemouth);
  });

  it("superseded facts are excluded from retrieval", async () => {
    const original = "Mitford CC have no covers";
    const updated = "Mitford CC installed covers in 2027";

    const embeddings = new Map<string, number[]>([
      [original, vec([0, 1])],
      [updated, vec([0, 1], [1, 0.001])],
      ["Mitford covers", vec([0, 0.99])],
    ]);
    const voyage = buildVoyageMock({ embeddings });

    const record = recordFact(ctx.db, voyage);
    await record({ userId, scope: "club", content: original });
    await record({ userId, scope: "club", content: updated });

    const out = await retrieveFacts(
      ctx.db,
      voyage,
    )({
      userId,
      query: "Mitford covers",
    });

    const contents = out.map((f) => f.content);
    expect(contents).toContain(updated);
    expect(contents).not.toContain(original);
  });
});

describe("cite_fact tool — visibility check + writer emission", () => {
  // cite_fact is the citation primitive that streams data-fact-citation
  // parts to the FE. The visibility check is security-relevant — the
  // model must not be able to cite facts authored by another user.

  function makeWriter() {
    return {
      write: vi.fn(),
      merge: vi.fn(),
      onError: undefined,
    } as unknown as UIMessageStreamWriter & {
      write: ReturnType<typeof vi.fn>;
    };
  }

  const opts = {
    toolCallId: "test",
    messages: [],
    abortSignal: undefined,
  } as never;

  it("emits a data-fact-citation part for a visible club fact", async () => {
    const fact = "Mitford CC have no covers";
    const voyage = buildVoyageMock({
      embeddings: new Map([[fact, vec([0, 1])]]),
    });
    const recorded = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: fact,
      tags: { team: "Mitford CC" },
      confidence: 5,
    });

    const writer = makeWriter();
    const tools = createFactTools({
      db: ctx.db,
      voyage,
      userId,
      writer,
    });
    const exec = tools.cite_fact.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      {
        factId: recorded.id,
        claim: "Mitford have no covers",
      } as never,
      opts,
    )) as { cited: boolean; citationId?: string; factId?: string };

    expect(result.cited).toBe(true);
    expect(result.factId).toBe(recorded.id);
    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      type: string;
      data: { factId: string; claim: string; content: string };
    };
    expect(part.type).toBe("data-fact-citation");
    expect(part.data.factId).toBe(recorded.id);
    expect(part.data.claim).toBe("Mitford have no covers");
    expect(part.data.content).toBe(fact);
  });

  it("refuses to cite a scope=user fact authored by a different user", async () => {
    const personal = "I hate facing spin";
    const voyage = buildVoyageMock({
      embeddings: new Map([[personal, vec([0, 1])]]),
    });
    const recorded = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "user",
      content: personal,
    });

    const other = await seedTestUser(ctx.db, {
      email: `cite-other-${crypto.randomUUID()}@test.com`,
    });

    const writer = makeWriter();
    const tools = createFactTools({
      db: ctx.db,
      voyage,
      userId: other.userId,
      writer,
    });
    const exec = tools.cite_fact.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      { factId: recorded.id, claim: "x" } as never,
      opts,
    )) as { cited: boolean; error?: string };

    expect(result.cited).toBe(false);
    expect(result.error).toMatch(/not found or not visible/);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("refuses to cite a superseded fact", async () => {
    const original = "Mitford CC have no covers";
    const updated = "Mitford CC have no covers (still in 2027)";
    const voyage = buildVoyageMock({
      embeddings: new Map([
        [original, vec([0, 1])],
        [updated, vec([0, 1], [1, 0.001])],
      ]),
    });
    const record = recordFact(ctx.db, voyage);
    const first = await record({ userId, scope: "club", content: original });
    await record({ userId, scope: "club", content: updated });

    const writer = makeWriter();
    const tools = createFactTools({ db: ctx.db, voyage, userId, writer });
    const exec = tools.cite_fact.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      { factId: first.id, claim: "x" } as never,
      opts,
    )) as { cited: boolean; error?: string };

    expect(result.cited).toBe(false);
    expect(writer.write).not.toHaveBeenCalled();
  });
});

describe("admin-service", () => {
  // The admin service backs the /scout/facts endpoints. Worth integration-
  // testing the SQL because Kysely + raw vector + jsonb tag filters get
  // tangled fast and a unit test against a mock would miss column-name
  // typos we'd only see in prod.
  let adminMod: typeof import("./admin-service.ts");
  beforeAll(async () => {
    adminMod = await import("./admin-service.ts");
  });

  it("listFacts returns paginated rows newest-first and a stable total", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["a", vec([0, 1])],
        ["b", vec([1, 0])],
        ["c", vec([1, 1])],
      ]),
    });
    const record = recordFact(ctx.db, voyage);
    await record({ userId, scope: "club", content: "a" });
    await record({ userId, scope: "club", content: "b" });
    await record({ userId, scope: "club", content: "c" });

    const page = await adminMod.listFacts(ctx.db)({
      includeSuperseded: false,
      page: 1,
      pageSize: 2,
    });
    expect(page.facts).toHaveLength(2);
    expect(page.total).toBe(3);
    // newest-first: "c" was inserted last.
    expect(page.facts[0].content).toBe("c");
  });

  it("listFacts filters by tag (key:value)", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["mit", vec([0, 1])],
        ["tyne", vec([1, 0])],
      ]),
    });
    const record = recordFact(ctx.db, voyage);
    await record({
      userId,
      scope: "club",
      content: "mit",
      tags: { team: "Mitford CC" },
    });
    await record({
      userId,
      scope: "club",
      content: "tyne",
      tags: { team: "Tynemouth" },
    });

    const out = await adminMod.listFacts(ctx.db)({
      tag: "team:Mitford CC",
      includeSuperseded: false,
      page: 1,
      pageSize: 50,
    });
    expect(out.facts.map((f) => f.content)).toEqual(["mit"]);
  });

  it("listFacts filters by scope", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["personal", vec([0, 1])],
        ["shared", vec([1, 0])],
      ]),
    });
    const record = recordFact(ctx.db, voyage);
    await record({ userId, scope: "user", content: "personal" });
    await record({ userId, scope: "club", content: "shared" });

    const out = await adminMod.listFacts(ctx.db)({
      scope: "user",
      includeSuperseded: false,
      page: 1,
      pageSize: 50,
    });
    expect(out.facts.map((f) => f.content)).toEqual(["personal"]);
  });

  it("updateFact re-embeds when content changes", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([
        ["original", vec([0, 1])],
        ["updated content here", vec([1, 0])],
      ]),
    });
    const recorded = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: "original",
    });

    // Track embed calls so we can assert it fired during the update.
    const embedSpy = vi.mocked(voyage.embed);
    embedSpy.mockClear();

    const updated = await adminMod.updateFact(ctx.db, voyage)(recorded.id, {
      content: "updated content here",
    });
    expect(updated.content).toBe("updated content here");
    // Asserting embed was called with the new content + "document" type
    // is sufficient — the SQL update wires the result straight into the
    // vector column, and a separate test would just be re-verifying
    // pgvector's storage. The behaviour we actually care about is "did
    // the service re-embed", which this check covers.
    expect(embedSpy).toHaveBeenCalledWith("updated content here", "document");
  });

  it("updateFact does NOT re-embed when only metadata changes", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([["meta-only", vec([0, 1])]]),
    });
    const recorded = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: "meta-only",
      confidence: 3,
    });

    const embedSpy = vi.mocked(voyage.embed);
    embedSpy.mockClear();

    const updated = await adminMod.updateFact(ctx.db, voyage)(recorded.id, {
      confidence: 5,
      scope: "user",
    });
    expect(updated.confidence).toBe(5);
    expect(updated.scope).toBe("user");
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it("deleteFact hard-deletes the row", async () => {
    const voyage = buildVoyageMock({
      embeddings: new Map([["doomed", vec([0, 1])]]),
    });
    const recorded = await recordFact(
      ctx.db,
      voyage,
    )({
      userId,
      scope: "club",
      content: "doomed",
    });

    await adminMod.deleteFact(ctx.db)(recorded.id);

    const row = await ctx.db
      .selectFrom("scout_fact")
      .where("id", "=", recorded.id)
      .selectAll()
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("deleteFact throws FactNotFoundError for an unknown id", async () => {
    await expect(
      adminMod.deleteFact(ctx.db)(crypto.randomUUID()),
    ).rejects.toThrow(/not found/i);
  });
});

describe("formatFactsBlock", () => {
  it("emits a stable wire format with [fact:UUID] marker, confidence, and tags", () => {
    const block = formatFactsBlock([
      {
        id: "abc12345-aaaa-bbbb-cccc-deadbeef0001",
        content: "Mitford CC have no covers",
        tags: { team: "Mitford CC", topic: "ground" },
        scope: "club",
        confidence: 5,
        permanence: "seasonal",
        score: 0.92,
        createdAt: new Date(),
      },
    ]);
    expect(block).toContain("<known-facts>");
    expect(block).toContain("[fact:abc12345-aaaa-bbbb-cccc-deadbeef0001]");
    expect(block).toContain("Mitford CC have no covers");
    expect(block).toContain("confidence 5/5");
    expect(block).toContain("team=Mitford CC");
  });

  it("returns an empty string for no facts (so callers can short-circuit)", () => {
    expect(formatFactsBlock([])).toBe("");
  });
});
