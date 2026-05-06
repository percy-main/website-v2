import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessageStreamWriter } from "ai";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Config } from "../../config.ts";
import type { ScoutReportStore } from "../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { createScoutAgent } from "./agent.ts";

// agent.prepareStep is the cost-critical hook that puts an Anthropic
// cacheControl breakpoint on the most recent message before each step. If
// this regresses, every multi-step Scout turn pays full input rate again
// for the accumulated tool results — the exact bug we shipped this for.

function makeAgent(mode: "chat" | "debrief" | "scout" = "chat") {
  // The agent only reaches its DB / writer during tool invocation; for
  // prepareStep tests we never invoke a tool, so empty stubs are safe.
  const stubDb = {} as Kysely<DB>;
  const stubPlayCricket = {} as PlayCricketApiClient;
  const stubWriter = {} as UIMessageStreamWriter;
  const stubConfig = {
    SCOUT_PROVIDER_CHAT: "anthropic",
    SCOUT_PROVIDER_DB: "anthropic",
    SCOUT_MODEL_CHAT: "claude-sonnet-4-6",
    SCOUT_MODEL_DB: "claude-haiku-4-5-20251001",
    SCOUT_MAX_STEPS: 20,
    SCOUT_DB_AGENT_MAX_STEPS: 8,
  } as Config;
  const stubScoutReports = {} as ScoutReportStore;

  return createScoutAgent({
    db: stubDb,
    dbReadonly: stubDb,
    playCricket: stubPlayCricket,
    config: stubConfig,
    writer: stubWriter,
    userId: "test-user",
    mode,
    scoutReports: stubScoutReports,
    thinkingMode: "thinking",
  });
}

describe("agent.prepareStep — cache-control breakpoint", () => {
  it("marks the most recent message with anthropic ephemeral cacheControl", () => {
    const agent = makeAgent();
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Scout Morpeth please" },
    ];

    const { messages: out } = agent.prepareStep({ messages });

    expect(out[2].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("leaves earlier messages untouched (single breakpoint, not many)", () => {
    const agent = makeAgent();
    const messages: ModelMessage[] = [
      { role: "user", content: "First" },
      { role: "user", content: "Second" },
      { role: "user", content: "Third" },
    ];

    const { messages: out } = agent.prepareStep({ messages });

    expect(out[0].providerOptions).toBeUndefined();
    expect(out[1].providerOptions).toBeUndefined();
    expect(out[2].providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
  });

  it("preserves any existing providerOptions on the last message", () => {
    const agent = makeAgent();
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "x",
        providerOptions: { custom: { foo: "bar" } },
      },
    ];

    const { messages: out } = agent.prepareStep({ messages });

    expect(out[0].providerOptions).toEqual({
      custom: { foo: "bar" },
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("returns input untouched when there are no messages", () => {
    const agent = makeAgent();
    const { messages: out } = agent.prepareStep({ messages: [] });
    expect(out).toEqual([]);
  });
});

describe("agent — mode-driven prompt + tool surface", () => {
  it("chat mode uses the free-form prompt and registers chart_render but not ask_question", () => {
    const agent = makeAgent("chat");
    expect(agent.system).toContain("ALWAYS try to answer from the local DB");
    expect(agent.system).not.toContain("running a post-match DEBRIEF");
    expect(agent.system).not.toContain("FOCUSED single-match");
    expect(agent.tools.chart_render).toBeDefined();
    expect(agent.tools.ask_question).toBeUndefined();
  });

  it("scout mode uses the focused prompt and still registers chart_render", () => {
    const agent = makeAgent("scout");
    expect(agent.system).toContain("FOCUSED single-match");
    expect(agent.tools.chart_render).toBeDefined();
    expect(agent.tools.ask_question).toBeUndefined();
  });

  it("debrief mode uses the debrief prompt and registers ask_question but not chart_render", () => {
    const agent = makeAgent("debrief");
    expect(agent.system).toContain("running a post-match DEBRIEF");
    expect(agent.tools.ask_question).toBeDefined();
    expect(agent.tools.chart_render).toBeUndefined();
  });
});
