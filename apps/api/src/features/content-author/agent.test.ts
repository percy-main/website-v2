import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessageStreamWriter } from "ai";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Config } from "../../config.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { createContentAuthorAgent } from "./agent.ts";
import { type EditorContext } from "./system-prompt.ts";

function makeAgent(overrides?: {
  provider?: "anthropic" | "deepseek";
  editorContext?: Partial<EditorContext>;
}) {
  // The agent only reaches its DB / writer during tool invocation, which these
  // tests never trigger - empty stubs are safe (mirrors scout/agent.test.ts).
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
    existingBlockTypes: [],
    ...overrides?.editorContext,
  };

  return createContentAuthorAgent({
    db: stubDb,
    dbReadonly: stubDb,
    playCricket: stubPlayCricket,
    config: stubConfig,
    writer: stubWriter,
    logger: createNoopLogger(),
    editorContext,
  });
}

describe("content-author agent - tool surface + reasoning", () => {
  it("registers the reused data tools and the write_content tool", () => {
    const agent = makeAgent();
    expect(agent.tools.write_content).toBeDefined();
    expect(agent.tools.pc_match_detail).toBeDefined();
    expect(agent.tools.db_run_sql).toBeDefined();
    expect(agent.tools.weather_get).toBeDefined();
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

  it("lists the writable blocks and excludes contentImage", () => {
    const agent = makeAgent();
    expect(agent.system).toContain("gamePreview");
    expect(agent.system).not.toContain("contentImage");
  });
});
