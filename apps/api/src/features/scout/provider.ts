import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import type { LanguageModel, LanguageModelUsage, ProviderMetadata } from "ai";

export type ScoutProvider = "anthropic" | "deepseek";

export interface ResolvedModel {
  provider: ScoutProvider;
  model: LanguageModel;
  // Anthropic charges separately for cache writes and reads and requires
  // explicit cacheControl markers. DeepSeek does prefix caching automatically
  // and ignores the marker — gate the prepareStep mutation on this flag so we
  // don't ship a no-op annotation to providers that don't understand it.
  supportsAnthropicCacheControl: boolean;
}

export function resolveModel(
  provider: ScoutProvider,
  modelId: string,
): ResolvedModel {
  switch (provider) {
    case "anthropic":
      return {
        provider,
        model: anthropic(modelId),
        supportsAnthropicCacheControl: true,
      };
    case "deepseek":
      return {
        provider,
        model: deepseek(modelId),
        supportsAnthropicCacheControl: false,
      };
  }
}

/**
 * providerOptions block that disables DeepSeek's chain-of-thought for a
 * single generateText call. Empty for any other provider — Anthropic has
 * no equivalent toggle, and an empty object is a safe no-op for the AI SDK.
 *
 * Use this on every sub-agent that does structured tool-calling
 * (ask_db, ask_play_cricket, the researcher loop, the analyst): the work
 * is mechanical orchestration, not deep reasoning, and DeepSeek-flash with
 * thinking enabled spends a multi-minute reasoning pass before its first
 * tool call which is wasted budget for these tasks.
 *
 * The Record<string, Record<string, JsonValue>> shape mirrors the AI SDK's
 * SharedV3ProviderOptions deep alias (not exported from the public "ai"
 * entry) — using a JSON tree avoids reaching into a transitive dep.
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export function deepseekFastProviderOptions(
  provider: ScoutProvider,
): Record<string, Record<string, JsonValue>> {
  return provider === "deepseek"
    ? { deepseek: { thinking: { type: "disabled" } } }
    : {};
}

export interface CacheUsage {
  cacheRead: number | undefined;
  cacheCreation: number | undefined;
}

// Pulls cached-input / cache-creation token counts out of the provider-
// specific metadata shape. Anthropic exposes both via
// providerMetadata.anthropic; DeepSeek exposes a single cached-prefix count
// via the AI SDK's normalised usage.inputTokenDetails.cacheReadTokens (no
// separate "creation" event — caching is automatic and free for the
// prefix-write side, only the cache-hit input is discounted).
export function extractCacheUsage(
  provider: ScoutProvider,
  usage: LanguageModelUsage,
  providerMeta: ProviderMetadata | undefined,
): CacheUsage {
  if (provider === "anthropic") {
    const meta = providerMeta?.anthropic as
      | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
      | undefined;
    return {
      cacheRead: meta?.cacheReadInputTokens,
      cacheCreation: meta?.cacheCreationInputTokens,
    };
  }
  return {
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? undefined,
    cacheCreation: undefined,
  };
}
