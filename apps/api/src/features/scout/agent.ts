import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";
import type { Tracer } from "@opentelemetry/api";
import type { DB } from "@percy-main/db";
import type {
  LanguageModel,
  ModelMessage,
  ToolSet,
  UIMessageStreamWriter,
} from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../config.ts";
import type { S3KnowledgeBaseStore } from "../../lib/s3-knowledge-base.ts";
import type { ScoutReportStore } from "../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type { VoyageClient } from "./facts/voyage.ts";
import { resolveModel } from "./provider.ts";
import type { ScoutMode } from "./schemas.ts";
import {
  SCOUT_DEBRIEF_SYSTEM_PROMPT,
  SCOUT_FOCUSED_SYSTEM_PROMPT,
  SCOUT_SYSTEM_PROMPT,
} from "./system-prompt.ts";
import { createAskQuestionTool } from "./tools/ask-question.ts";
import { createScoutCache } from "./tools/cache.ts";
import { createChartTool } from "./tools/chart.ts";
import { createDbTools } from "./tools/db.ts";
import { createFaceDetector } from "./tools/face-detection.ts";
import { createFactTools } from "./tools/facts.ts";
import { createGenerateReportTool } from "./tools/generate-report.ts";
import { createKnowledgeTools } from "./tools/knowledge.ts";
import { createPlayCricketCitationTools } from "./tools/play-cricket-citations.ts";
import { createPlayCricketTools } from "./tools/play-cricket.ts";
import { createPlayerFacesTool } from "./tools/player-faces.ts";
import { createRecognitionSourcesTool } from "./tools/recognition-sources.ts";
import { createRenderImageTool } from "./tools/render-image.ts";
import { createRenderVideoTool } from "./tools/render-video.ts";
import { createTavilyClient } from "./tools/tavily.ts";
import { createWeatherTools } from "./tools/weather.ts";

// streamText's providerOptions is typed as a deep alias not re-exported from
// the public "ai" entrypoint (lives in @ai-sdk/provider as
// SharedV3ProviderOptions). Inline the structural shape — the only thing we
// ever build is one nested object keyed by provider id, so a JSONValue tree
// is sufficient and avoids reaching into a transitive dep.
type ScoutJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ScoutJsonValue }
  | ScoutJsonValue[];
type ScoutProviderOptions = Record<string, Record<string, ScoutJsonValue>>;

/**
 * Scout's agent config — model, system prompt, and the tool dictionary that
 * gets passed to AI SDK v6's streamText / generateText. We use AI SDK
 * directly because v6's UIMessageStream bridges cleanly to the v6 frontend
 * useChat. Mastra was evaluated and dropped: its MastraModelOutput doesn't
 * expose a v6-compatible UIMessageStream and we didn't need its sub-agent /
 * durable workflow features for v1.
 */
export interface ScoutAgentDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  // Stream writer used by chart_render to emit data-chart parts inline with
  // the assistant's prose. The route wraps streamText in createUIMessageStream
  // and passes the resulting writer down.
  writer: UIMessageStreamWriter;
  logger: FastifyBaseLogger;
  // Fact-RAG dependencies. Optional so the agent can boot without a Voyage
  // API key — the fact_record / fact_retrieve tools are simply omitted in
  // that case. userId is the authenticated caller; threadId is attached to
  // every recorded fact for traceability.
  voyage?: VoyageClient;
  userId: string;
  // Display name of the authenticated caller. Injected into the system
  // prompt so the agent can address the captain by name in conversation
  // (DeepSeek otherwise defaults to generic "Captain"-style openers, which
  // reads off in a 1:1 chat).
  userName: string;
  threadId?: string;
  // Interaction mode — fixed at thread creation. Picks system prompt and
  // toggles the ask_question / chart_render tool surface (debrief uses
  // ask_question and skips charts; scouting is the inverse).
  mode: ScoutMode;
  // S3 store for the generate_report tool. Required in scouting mode (the
  // only mode where the tool is registered); ignored in debrief.
  scoutReports: ScoutReportStore;
  // S3 store for the knowledge base. Optional — when absent (or when
  // VOYAGE_API_KEY is unset), the knowledge_search / cite_kb tools
  // are simply not registered.
  scoutKnowledgeBase?: S3KnowledgeBaseStore;
  // Per-turn reasoning toggle. "thinking" = chain-of-thought enabled (slower,
  // better on multi-step queries); "fast" = thinking disabled (lower latency,
  // best for follow-ups). Only DeepSeek currently honours this — Sonnet 4.6
  // has no native thinking knob, so the flag is a no-op when chat provider
  // is anthropic.
  thinkingMode: ThinkingMode;
  // Arize Phoenix tracer for LLM spans. AI SDK calls below thread this
  // through experimental_telemetry.tracer so generative spans land in the
  // isolated Phoenix tracer provider rather than the global (New Relic) one.
  phoenixTracer: Tracer;
}

export type ThinkingMode = "thinking" | "fast";

export interface ScoutAgent {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  prepareStep: (args: { messages: ModelMessage[] }) => {
    messages: ModelMessage[];
  };
  // Provider-specific options merged into streamText. Currently only used to
  // toggle DeepSeek's thinking mode per turn; empty for anthropic runs.
  providerOptions: ScoutProviderOptions;
}

export function createScoutAgent(deps: ScoutAgentDeps): ScoutAgent {
  const cache = createScoutCache(deps.db);
  // Raw pc_* tools, not a wrapping sub-agent. The cache instance is shared
  // with the weather tools so a multi-step scouting flow can reuse a cached
  // match_summary across pc_* calls without round-tripping the API.
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
    logger: deps.logger,
  });
  // Direct DB access: db_list_tables / db_describe_table / db_run_sql wired
  // straight into the agent. There used to be ask_db / ask_ball_by_ball
  // sub-agents wrapping these; they were dropped because the summarising hop
  // hid the actual rows, SQL, and errors from the main agent (the very
  // context it needs to reason about cricket). The agent now writes SQL
  // itself against the full allowlist (general scouting tables plus the
  // ball-by-ball surface). The read-only pool is the security boundary.
  const dbTools = createDbTools({
    dbReadonly: deps.dbReadonly,
    logger: deps.logger,
  });
  const weatherTools = createWeatherTools({ cache });
  // Charts are useful in chat / scout answers but out of place in a debrief
  // interview — register chart_render for the two scouting-shaped modes only.
  const chartTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createChartTool({ writer: deps.writer })
      : {};
  // render_video is gated to the same modes as chart_render. Debrief is a
  // structured interview — embedding a clip mid-flow would derail it.
  const videoTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createRenderVideoTool({ writer: deps.writer })
      : {};
  // render_image renders recognition-source photos inline. Same gating as
  // chart / video — chat + scout only, never debrief.
  const imageTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createRenderImageTool({ writer: deps.writer })
      : {};
  // player_faces is the richer recognition-card surface — face thumbnails
  // up front, expandable to full source images. Preferred over
  // render_image whenever the recognition tool returned face-bearing
  // candidates. Same gating as render_image.
  const playerFacesTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createPlayerFacesTool({ writer: deps.writer })
      : {};
  // generate_report builds a PDF and stores it in S3. Relevant in chat (the
  // captain may ask) and scout (the focused mode self-triggers the tool); not
  // in debrief, which surfaces a structured interview rather than a document.
  // threadId is required to file reports against the owning thread, so we
  // only register the tool when one is present.
  //
  // The tool only queues the job: a background report-builder agent (ECS in
  // prod, in-process in dev) gathers the data and assembles the PDF on its
  // own. The main chat agent never streams the report content itself; it just
  // confirms the report was queued.
  const reportTools =
    (deps.mode === "chat" || deps.mode === "scout") && deps.threadId
      ? createGenerateReportTool({
          db: deps.db,
          dbReadonly: deps.dbReadonly,
          playCricket: deps.playCricket,
          config: deps.config,
          voyage: deps.voyage,
          scoutReports: deps.scoutReports,
          writer: deps.writer,
          userId: deps.userId,
          threadId: deps.threadId,
          logger: deps.logger,
          phoenixTracer: deps.phoenixTracer,
        })
      : {};
  // ask_question is the inverse: only in debrief, where the agent walks
  // the captain through structured prompts via inline button cards.
  const askQuestionTools =
    deps.mode === "debrief"
      ? createAskQuestionTool({ writer: deps.writer })
      : {};
  // Match / player-stats citation tools — companions to cite_fact. They
  // don't need the DB or any external client, only the writer to stream
  // data-*-citation parts to the FE alongside the assistant's prose.
  const playCricketCitationTools = createPlayCricketCitationTools({
    writer: deps.writer,
  });
  // Recognition-source discovery (find_player_photo_sources). Public-source
  // discovery only — see ADR 042 for the privacy framing. Registered in
  // chat / scout modes only; debrief is a structured interview and a
  // recognition tool would derail it.
  const recognitionTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createRecognitionSourcesTool({
          search: createTavilyClient({
            apiKey: deps.config.TAVILY_API_KEY,
            logger: deps.logger,
          }),
          // Face detection runs inline on every recognition tool call, so
          // wire up dedicated AWS clients here. Both clients share the
          // configured region; the S3 client honours S3_ENDPOINT for local
          // dev (Minio / Localstack), Rekognition does not — it's an
          // AWS-only service.
          faceDetector: createFaceDetector({
            rekognition: new RekognitionClient({
              region: deps.config.AWS_REGION,
            }),
            s3: new S3Client({
              region: deps.config.S3_REGION,
              ...(deps.config.S3_ENDPOINT
                ? {
                    endpoint: deps.config.S3_ENDPOINT,
                    forcePathStyle: true,
                  }
                : {}),
            }),
            bucket: deps.config.SCOUT_ATTACHMENTS_BUCKET,
            prefix: `${deps.config.SCOUT_ATTACHMENTS_PREFIX}/faces`,
            logger: deps.logger,
          }),
          logger: deps.logger,
        })
      : {};
  // Fact tools only register when Voyage is configured. Auto-retrieval in
  // the route also short-circuits in that case, so a deployment without
  // VOYAGE_API_KEY behaves as if the RAG layer doesn't exist.
  const factTools = deps.voyage
    ? createFactTools({
        db: deps.db,
        voyage: deps.voyage,
        userId: deps.userId,
        threadId: deps.threadId,
        // Same writer the chart tool uses — cite_fact emits
        // data-fact-citation parts inline with assistant prose.
        writer: deps.writer,
        // Used to log raw Voyage error bodies server-side without
        // surfacing them to the model.
        logger: deps.logger,
      })
    : {};

  // KB tools share Voyage with the fact tools. They additionally need
  // the S3 KB store decoration so cite_kb / knowledge_search can
  // resolve chunks back to their parent document. Same gating: when
  // VOYAGE_API_KEY is unset, the agent runs without KB at all.
  const knowledgeTools =
    deps.voyage && deps.scoutKnowledgeBase
      ? createKnowledgeTools({
          db: deps.db,
          voyage: deps.voyage,
          store: deps.scoutKnowledgeBase,
          userId: deps.userId,
          threadId: deps.threadId,
          writer: deps.writer,
          logger: deps.logger,
        })
      : {};

  // Anchor "today" so the model doesn't fall back to its training cutoff
  // when picking a default season AND so it filters past/future matches
  // correctly. Resolved per-request, not at module load.
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const dayName = today.toLocaleDateString("en-GB", { weekday: "long" });
  const ddmmyyyy = today.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const todayLine = `Today is ${dayName} ${iso}. The current season is ${today.getFullYear()}; default to it when the user doesn't specify a year.

Date formats are split between sources:
- The Play Cricket API (queried via the pc_* tools) emits match_date in dd/mm/yyyy — today is ${ddmmyyyy} in that format. Pass dd/mm/yyyy values back through unchanged.
- Our database (queried via db_run_sql) stores match_date as ISO ${iso}-style. Lex order = chronological order.

When asked about the "next" or "upcoming" match for ANY club (Percy Main or opposition), call pc_match_summary / pc_site_matches with match_date filtered against today (${iso}). The local DB only carries fixtures for matches that already have a synced scorecard, so it's not the right source for upcoming-fixture questions. Don't trust your gut on what day-of-week a date falls on; always compare against the iso date above.`;

  const basePrompt =
    deps.mode === "debrief"
      ? SCOUT_DEBRIEF_SYSTEM_PROMPT
      : deps.mode === "scout"
        ? SCOUT_FOCUSED_SYSTEM_PROMPT
        : SCOUT_SYSTEM_PROMPT;

  const userLine = `You are speaking with ${deps.userName} (a Percy Main official or admin). Address them by their first name when it reads naturally — don't force it into every reply.`;

  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_CHAT,
    deps.config.SCOUT_MODEL_CHAT,
  );

  // DeepSeek-v4-pro defaults to thinking-on. Sending an explicit
  // { type: "disabled" } through providerOptions skips the chain-of-thought
  // pass for fast follow-ups. Anthropic doesn't expose a knob like this on
  // Sonnet 4.6, so we leave its options empty regardless of the toggle.
  const providerOptions: ScoutProviderOptions =
    resolved.provider === "deepseek"
      ? {
          deepseek: {
            thinking: {
              type: deps.thinkingMode === "fast" ? "disabled" : "enabled",
            },
          },
        }
      : {};

  return {
    model: resolved.model,
    system: `${basePrompt}\n\n${userLine}\n\n${todayLine}`,
    tools: {
      ...playCricketTools,
      ...dbTools,
      ...weatherTools,
      ...chartTools,
      ...videoTools,
      ...imageTools,
      ...playerFacesTools,
      ...reportTools,
      ...askQuestionTools,
      ...factTools,
      ...knowledgeTools,
      ...playCricketCitationTools,
      ...recognitionTools,
    },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
    prepareStep: ({ messages }) => ({
      messages: resolved.supportsAnthropicCacheControl
        ? addCacheControlToLastMessage(messages)
        : messages,
    }),
    providerOptions,
  };
}

/**
 * Mark the most recent message with Anthropic's ephemeral cacheControl so
 * the prefix-up-to-here is cached. Each agentic step moves the breakpoint
 * forward, so by step N the previous N-1 steps' content is being read from
 * cache (~10% cost) instead of paid as fresh input. With our heavy Play
 * Cricket tool results, this is the difference between paying for a 50KB
 * payload once vs. on every subsequent step in the loop.
 *
 * Pattern lifted from the AI SDK v6 dynamic-prompt-caching cookbook —
 * marking only the last message is sufficient because Anthropic caches
 * incrementally up to the breakpoint.
 */
function addCacheControlToLastMessage(
  messages: ModelMessage[],
): ModelMessage[] {
  if (messages.length === 0) return messages;
  return messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    };
  });
}
