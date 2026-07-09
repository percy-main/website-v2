import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessageStreamWriter } from "ai";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Config } from "../../config.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type { VoyageClient } from "../scout/facts/voyage.ts";
import { createContentAuthorAgent } from "./agent.ts";
import { type EditorContext } from "./system-prompt.ts";

function makeAgent(overrides?: {
  provider?: "anthropic" | "deepseek";
  editorContext?: Partial<EditorContext>;
  withVoyage?: boolean;
}) {
  // The agent only reaches its DB / writer during tool invocation, which these
  // tests never trigger - empty stubs are safe (mirrors scout/agent.test.ts).
  // A stub voyage is enough to construct fact_retrieve (it isn't called here).
  const stubDb = {} as Kysely<DB>;
  const stubPlayCricket = {} as PlayCricketApiClient;
  const stubWriter = {} as UIMessageStreamWriter;
  const provider = overrides?.provider ?? "deepseek";
  const stubConfig = {
    CONTENT_AI_PROVIDER: provider,
    CONTENT_AI_MODEL:
      provider === "anthropic" ? "claude-sonnet-4-6" : "deepseek-v4-pro",
    SCOUT_MAX_STEPS: 20,
  } as Config;

  const editorContext: EditorContext = {
    kind: "game_report",
    title: "Percy Main vs Tynemouth",
    metadata: { playCricketId: "999" },
    blocks: [],
    ...overrides?.editorContext,
  };

  return createContentAuthorAgent({
    db: stubDb,
    dbReadonly: stubDb,
    playCricket: stubPlayCricket,
    config: stubConfig,
    writer: stubWriter,
    logger: createNoopLogger(),
    userId: "test-user",
    voyage: overrides?.withVoyage ? ({} as VoyageClient) : undefined,
    editorContext,
  });
}

describe("content-author agent - tool surface + reasoning", () => {
  it("registers the reused data tools and the content tools", () => {
    const agent = makeAgent();
    expect(agent.tools.write_content).toBeDefined();
    expect(agent.tools.edit_content).toBeDefined();
    expect(agent.tools.pc_match_detail).toBeDefined();
    expect(agent.tools.db_run_sql).toBeDefined();
    expect(agent.tools.weather_get).toBeDefined();
  });

  it("registers read-only fact_retrieve when voyage is configured (and not fact_record)", () => {
    const agent = makeAgent({ withVoyage: true });
    expect(agent.tools.fact_retrieve).toBeDefined();
    expect(agent.tools.fact_record).toBeUndefined();
    expect(agent.tools.cite_fact).toBeUndefined();
  });

  it("omits fact_retrieve when voyage is not configured", () => {
    const agent = makeAgent({ withVoyage: false });
    expect(agent.tools.fact_retrieve).toBeUndefined();
  });

  it("enables reasoning for deepseek", () => {
    const agent = makeAgent({ provider: "deepseek" });
    expect(agent.providerOptions).toEqual({
      deepseek: { thinking: { type: "enabled" } },
    });
  });

  it("enables extended thinking for anthropic", () => {
    const agent = makeAgent({ provider: "anthropic" });
    expect(agent.providerOptions).toMatchObject({
      anthropic: { thinking: { type: "enabled" } },
    });
  });
});

describe("content-author agent - prepareStep cache control", () => {
  it("marks the last message with anthropic ephemeral cacheControl", () => {
    const agent = makeAgent({ provider: "anthropic" });
    const messages: ModelMessage[] = [
      { role: "user", content: "Write a match report" },
    ];
    const { messages: out } = agent.prepareStep({ messages });
    expect(out[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("is a no-op for deepseek (it caches prefixes automatically)", () => {
    const agent = makeAgent({ provider: "deepseek" });
    const messages: ModelMessage[] = [{ role: "user", content: "Hi" }];
    const { messages: out } = agent.prepareStep({ messages });
    expect(out[0].providerOptions).toBeUndefined();
  });
});

describe("content-author agent - system prompt", () => {
  it("carries the positive-tone, no-blame guidance", () => {
    const agent = makeAgent();
    expect(agent.system).toContain("positive");
    expect(agent.system).toContain("NEVER call out");
  });

  it("insists on grounding and forbids em dashes", () => {
    const agent = makeAgent();
    expect(agent.system).toContain("NEVER make anything up");
    expect(agent.system).toContain("U+2014");
  });

  it("adds fact_retrieve grounding guidance only when voyage is configured", () => {
    expect(makeAgent({ withVoyage: true }).system).toContain("fact_retrieve");
    expect(makeAgent({ withVoyage: false }).system).not.toContain(
      "fact_retrieve",
    );
  });

  it("injects the editor metadata so research is grounded", () => {
    const agent = makeAgent({
      editorContext: {
        kind: "game_report",
        title: "T",
        metadata: { playCricketId: "777" },
      },
    });
    expect(agent.system).toContain("777");
    expect(agent.system).toContain("game_report");
  });

  it("lists the writable blocks and excludes contentImage from the catalog", () => {
    const agent = makeAgent();
    expect(agent.system).toContain("gamePreview");
    // The catalog reference lists blocks as `type` in backticks; contentImage
    // must not be offered there (it IS named in the editing rules as a block
    // the agent must not rewrite).
    expect(agent.system).not.toContain("`contentImage`");
  });

  it("says the draft is empty when there are no blocks", () => {
    const agent = makeAgent({ editorContext: { blocks: [] } });
    expect(agent.system).toContain("The draft is currently empty.");
  });

  it("treats a single blank paragraph as an empty draft but names its id", () => {
    const agent = makeAgent({
      editorContext: { blocks: [{ id: "blank1", type: "paragraph" }] },
    });
    expect(agent.system).toContain("currently empty");
    expect(agent.system).toContain("id=blank1");
  });

  it("renders the draft listing with ids, nesting and formatting markers", () => {
    const agent = makeAgent({
      editorContext: {
        blocks: [
          {
            id: "h1",
            type: "heading",
            props: { level: 2 },
            content: "A fine win",
          },
          {
            id: "p1",
            type: "paragraph",
            content: "See the fixtures page.",
            hasFormatting: true,
            children: [{ id: "c1", type: "bulletListItem", content: "Nested" }],
          },
        ],
      },
    });
    expect(agent.system).toContain("[id=h1] heading");
    expect(agent.system).toContain('"A fine win"');
    expect(agent.system).toContain('{"level":2}');
    expect(agent.system).toContain(
      "[id=p1] paragraph: \"See the fixtures page.\" [has formatting - rewriting loses bold/links]",
    );
    expect(agent.system).toContain("[id=c1] bulletListItem");
    // Editing guidance ships whenever the tools do.
    expect(agent.system).toContain("edit_content");
  });
});
