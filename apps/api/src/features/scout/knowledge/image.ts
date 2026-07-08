/**
 * Image → caption for the KB ingestion pipeline.
 *
 * The agent retrieves chunks by semantic similarity, so an image only
 * becomes useful once we have a textual description of it embedded in
 * the chunk store. We reuse the Haiku caption pattern from Track 1's
 * derive.ts, but bias the prompt toward longer, retrieval-friendly
 * descriptions — admin uploads tend to be diagrams (e.g. ground
 * layouts, set-piece sketches) and photographed pages where every
 * visible word matters.
 */

import type { Tracer } from "@opentelemetry/api";
import { generateText, type LanguageModel } from "ai";
import { buildPhoenixTelemetry } from "../telemetry.ts";

const KB_IMAGE_PROMPT = `You will be shown an image uploaded to a cricket-club knowledge base. Produce a thorough, factual description that would let someone search for and re-find this image later.

Cover, in this order:
1. What kind of image it is (diagram / photograph / scanned page / chart / map).
2. The visible subject — people, objects, layout, setting.
3. Any text that appears on the image — transcribe it verbatim, in reading order. Include captions, labels, headers, signatures, and any small print.
4. Anything notable about colours, arrows, highlights, or annotations.

Aim for 6–12 sentences. Do not interpret, speculate, or identify named individuals beyond labels visible in the image itself.`;

export class ImageCaptionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ImageCaptionError";
  }
}

export interface CaptionImageInput {
  bytes: Buffer;
  contentType: string;
}

/**
 * Caption a single image. Returns the caption text — the caller is
 * responsible for treating it as a single-chunk document.
 */
export async function captionImage(
  model: LanguageModel,
  maxOutputTokens: number,
  phoenixTracer: Tracer,
  input: CaptionImageInput,
): Promise<string> {
  let result;
  try {
    result = await generateText({
      model,
      maxOutputTokens,
      telemetry: buildPhoenixTelemetry(
        phoenixTracer,
        "scout.kb_caption_image",
      ),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: KB_IMAGE_PROMPT },
            {
              type: "image",
              image: input.bytes,
              mediaType: input.contentType,
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new ImageCaptionError("Failed to caption image via Haiku", err);
  }

  const text = result.text.trim();
  if (!text) {
    throw new ImageCaptionError("Haiku returned empty caption");
  }
  return text;
}
