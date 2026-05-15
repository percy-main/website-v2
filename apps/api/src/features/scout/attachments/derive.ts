import type { Tracer } from "@opentelemetry/api";
import type { DB } from "@percy-main/db";
import { generateText } from "ai";
import type { Kysely } from "kysely";
import { resolveModel } from "../provider.ts";
import { buildPhoenixTelemetry } from "../telemetry.ts";

export type AttachmentKind = "image" | "pdf";

const IMAGE_PROMPT = `You will be shown an image. Describe its contents factually and concretely in 2–4 short sentences. Cover what is visible: people, objects, text, layout, setting. Do not interpret, speculate, or identify named individuals. If text is visible, transcribe key text verbatim where useful (team sheets, scoreboards, captions).`;

const PDF_PROMPT = `You will be shown a PDF document. Transcribe the readable text verbatim (preserve names, numbers, headings, and tabular structure where possible). After the transcription, add a short factual summary (2–4 sentences) of what the document is and contains. Do not interpret or speculate beyond what is on the page.`;

export interface DeriveDeps {
  db: Kysely<DB>;
  modelId: string;
  maxOutputTokens: number;
  derivedTextMaxBytes: number;
  phoenixTracer: Tracer;
}

export interface DeriveInput {
  kind: AttachmentKind;
  contentHash: string;
  contentType: string;
  bytes: Buffer;
}

export interface DeriveOutput {
  derivedText: string;
  source: "haiku-caption" | "pdf-extract";
  /** True when served from scout_attachment_cache; skips the Haiku call. */
  cacheHit: boolean;
}

export class DeriveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DeriveError";
  }
}

export function deriveAttachment(deps: DeriveDeps) {
  // Always Haiku — the chat agent might be on DeepSeek but image / PDF
  // input requires Anthropic regardless.
  const { model } = resolveModel("anthropic", deps.modelId);

  return async (input: DeriveInput): Promise<DeriveOutput> => {
    const cached = await deps.db
      .selectFrom("scout_attachment_cache")
      .where("content_hash", "=", input.contentHash)
      .select(["derived_text", "source"])
      .executeTakeFirst();

    if (cached) {
      return {
        derivedText: cached.derived_text,
        source: cached.source as DeriveOutput["source"],
        cacheHit: true,
      };
    }

    const source: DeriveOutput["source"] =
      input.kind === "image" ? "haiku-caption" : "pdf-extract";

    let result;
    try {
      result = await generateText({
        model,
        maxOutputTokens: deps.maxOutputTokens,
        experimental_telemetry: buildPhoenixTelemetry(
          deps.phoenixTracer,
          `scout.attachment_derive.${input.kind}`,
        ),
        messages: [
          {
            role: "user",
            content:
              input.kind === "image"
                ? [
                    { type: "text", text: IMAGE_PROMPT },
                    {
                      type: "image",
                      image: input.bytes,
                      mediaType: input.contentType,
                    },
                  ]
                : [
                    { type: "text", text: PDF_PROMPT },
                    {
                      type: "file",
                      data: input.bytes,
                      mediaType: "application/pdf",
                    },
                  ],
          },
        ],
      });
    } catch (err) {
      throw new DeriveError(
        input.kind === "image"
          ? "Failed to caption image via Haiku"
          : "Failed to extract PDF via Haiku",
        err,
      );
    }

    const derivedText = truncate(result.text.trim(), deps.derivedTextMaxBytes);

    if (!derivedText) {
      throw new DeriveError(
        `Haiku returned empty text for ${input.kind} attachment`,
      );
    }

    // ON CONFLICT: a concurrent commit on the same content_hash might
    // have already written the row. Cheaper to ignore than to lock.
    await deps.db
      .insertInto("scout_attachment_cache")
      .values({
        content_hash: input.contentHash,
        kind: input.kind,
        derived_text: derivedText,
        source,
      })
      .onConflict((oc) => oc.column("content_hash").doNothing())
      .execute();

    return { derivedText, source, cacheHit: false };
  };
}

function truncate(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= maxBytes) return value;
  // Walk back from maxBytes until we're not in the middle of a UTF-8
  // continuation byte (top bits 10xxxxxx). Append a marker so the
  // chat-attachments block signals the cap rather than a silent cut.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return `${buf.subarray(0, end).toString("utf8")}\n\n[truncated]`;
}
