import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessageStreamWriter } from "ai";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Config } from "../../config.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { createScoutAgent } from "./agent.ts";

// agent.prepareStep is the cost-critical hook that puts an Anthropic
// cacheControl breakpoint on the most recent message before each step. If
// this regresses, every multi-step Scout turn pays full input rate again
// for the accumulated tool results — the exact bug we shipped this for.

function makeAgent() {
  // The agent only reaches its DB / writer during tool invocation; for
  // prepareStep tests we never invoke a tool, so empty stubs are safe.
  const stubDb = {} as Kysely<DB>;
  const stubPlayCricket = {} as PlayCricketApiClient;
  const stubWriter = {} as UIMessageStreamWriter;
  const stubConfig = {
    SCOUT_MODEL_CHAT: "claude-sonnet-4-6",
    SCOUT_MAX_STEPS: 20,
  } as Config;

  return createScoutAgent({
    db: stubDb,
    dbReadonly: stubDb,
    playCricket: stubPlayCricket,
    config: stubConfig,
    writer: stubWriter,
    userId: "test-user",
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
