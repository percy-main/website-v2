import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../../config.ts";
import type { TeamNewsData } from "../matchday/service.ts";

export const CAPTION_PROMPT_VERSION = "v1";
export const CAPTION_HASHTAG_SUFFIX =
  "#PMCC #NTCL #cricket #percymain" as const;

const MAX_LLM_CAPTION_CHARS = 220;
const LLM_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT =
  `You are drafting a short social-media caption for Percy Main Cricket Club's ` +
  `match-day team announcement. You MUST use the provided fixture facts only. ` +
  `Do not invent player names, stats, or commentary. Keep the tone upbeat but ` +
  `understated.\n\n` +
  `Voice / style rules:\n` +
  `- Do not include hashtags (they are appended automatically).\n` +
  `- Do not @-mention any account.\n` +
  `- Do not use emojis unless they appear verbatim in the team/opposition name.\n` +
  `- If a match sponsor is provided, thank them by name in the caption.\n` +
  `- Do not thank sponsors that are not provided.\n` +
  `- Max 220 characters (leaves room for the hashtag suffix).`;

function buildUserPrompt(data: TeamNewsData, captainName: string): string {
  return [
    "Fixture:",
    `- Team: ${data.teamName}`,
    `- Opposition: ${data.opposition}`,
    `- Date: ${formatDate(data.matchDate)}`,
    `- Venue: ${data.isHome ? "home" : "away"}`,
    `- Captain: ${captainName}`,
    `- Match sponsor: ${data.matchSponsor?.name ?? "none"}`,
  ].join("\n");
}

export interface LlmClient {
  generateCaption: (args: {
    systemPrompt: string;
    userPrompt: string;
    timeoutMs: number;
  }) => Promise<string>;
}

export function createLlmClient(config: Config): LlmClient {
  if (!config.ANTHROPIC_API_KEY) {
    return {
      generateCaption: () => {
        throw new Error("ANTHROPIC_API_KEY not configured");
      },
    };
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  return {
    async generateCaption({ systemPrompt, userPrompt, timeoutMs }) {
      const response = await client.messages.create(
        {
          model: "claude-haiku-4-5",
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          tools: [
            {
              name: "team_sheet_caption",
              description: "Return the final team sheet caption.",
              input_schema: {
                type: "object",
                required: ["caption"],
                properties: {
                  caption: { type: "string", maxLength: 280 },
                },
              },
            },
          ],
          tool_choice: { type: "tool", name: "team_sheet_caption" },
        },
        { timeout: timeoutMs },
      );

      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === "team_sheet_caption") {
          const input = block.input as { caption?: unknown };
          if (typeof input.caption === "string") return input.caption;
        }
      }
      throw new Error("LLM returned no caption tool_use block");
    },
  };
}

export interface CaptionResult {
  caption: string;
  source: "ai" | "fallback";
  version: string;
}

export function generateCaption(llm: LlmClient) {
  return async (data: TeamNewsData): Promise<CaptionResult> => {
    const captainName = data.players[0]?.playerName ?? "the captain";
    const userPrompt = buildUserPrompt(data, captainName);

    try {
      const raw = await llm.generateCaption({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        timeoutMs: LLM_TIMEOUT_MS,
      });

      const stripped = stripHashtags(raw).trim();
      if (!stripped || stripped.length > MAX_LLM_CAPTION_CHARS + 60) {
        throw new Error("LLM caption out of bounds");
      }

      return {
        caption: `${stripped}\n\n${CAPTION_HASHTAG_SUFFIX}`,
        source: "ai",
        version: CAPTION_PROMPT_VERSION,
      };
    } catch {
      return {
        caption: buildFallback(data, captainName),
        source: "fallback",
        version: CAPTION_PROMPT_VERSION,
      };
    }
  };
}

function buildFallback(data: TeamNewsData, captainName: string): string {
  const sponsorLine = data.matchSponsor
    ? ` Thanks to our match sponsor ${data.matchSponsor.name}.`
    : "";
  const venueVerb = data.isHome ? "host" : "travel to";
  return (
    `Team sheet confirmed — ${data.teamName} ${venueVerb} ${data.opposition} ` +
    `on ${formatDate(data.matchDate)}. Good luck to captain ${captainName} and ` +
    `the lads.${sponsorLine}\n\n${CAPTION_HASHTAG_SUFFIX}`
  );
}

function stripHashtags(text: string): string {
  return text
    .replace(/#\w+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatDate(iso: string): string {
  const date = new Date(iso + "T12:00:00");
  const day = date.getUTCDate();
  const month = date.toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  const weekday = date.toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `${weekday} ${day} ${month}`;
}
