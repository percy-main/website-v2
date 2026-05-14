import { imageSpecSchema, type ImageSpec } from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface RenderImageToolDeps {
  // Same writer pattern as chart_render / render_video — the route wraps
  // streamText in a createUIMessageStream and hands the writer down so this
  // tool can emit a data-image part inline with the assistant's prose.
  writer: UIMessageStreamWriter;
}

// Anthropic requires every tool's input_schema to be an OBJECT at the top
// level. Wrap the spec in an `{ image: ... }` envelope, matching chart_render
// and render_video.
const renderImageInputSchema = z.object({
  image: imageSpecSchema,
});

export function createRenderImageTool(deps: RenderImageToolDeps) {
  const { writer } = deps;

  return {
    render_image: tool({
      description: `Render an image inline in the chat. The frontend embeds the image so the captain sees it immediately — no clicks, no copy-paste of URLs.

This tool exists specifically to surface RECOGNITION-SOURCE photos returned by find_player_photo_sources. Call it after that tool returns candidates with an imageUrl. Render the most useful image per candidate (or per player), then write the prose around it.

When to render:
- A find_player_photo_sources candidate carries a real imageUrl from the recognition pipeline.
- You're listing 1–4 candidates per player and want each image to appear inline rather than as a bare URL the captain has to click.

When NOT to render:
- You don't have a real imageUrl from a tool result — NEVER invent URLs.
- The candidate's only signal is the page URL (no imageUrl) — link to the page in prose instead.
- You'd be rendering more than ~4 images per player; pick the best and link the rest.

Inputs (wrap in { "image": {...} }):
- imageUrl — REQUIRED. Pass-through from the recognition candidate.
- sourceUrl — the page where the image was found. Rendered as a 'view source' link beneath the image.
- alt — REQUIRED. Describe what the image is, e.g. "Candidate photo of Thomas Parkinson from Rock CC's Facebook group post". The captain may have screen reader / image-blocked browser, and alt is also the fallback when the image fails to load.
- caption — one short line below the image. Attribute the source ("Rock CC Facebook group") or note context.
- confidence — "high" / "medium" / "low" — mirror the level the recognition tool returned for this source. The FE renders a coloured chip.
- warnings — pass through verbatim. Login-wall warnings and "image not individually labelled" caveats MUST be surfaced.
- faces — pass through the recognition candidate's faces[] array verbatim when present. These are pre-cropped face thumbnails (signed S3 URLs) that the FE renders as a grid beneath the main image. NEVER invent face URLs. When the candidate has no faces[] (or an empty array), omit this field — the FE handles "no faces" gracefully.

After rendering, still write the surrounding prose. Don't describe the image you're about to show — call out the takeaway (which candidate it's for, why it's worth a look) and let the image carry the rest.

EXAMPLE — surfacing a recognition-source photo with a login-wall caveat:
{
  "image": {
    "imageUrl": "https://scontent-iad3-2.xx.fbcdn.net/...516788844_10163010079732140.jpg",
    "sourceUrl": "https://www.facebook.com/groups/174184335514/posts/10168750193370515/",
    "alt": "Candidate photo of Thomas Parkinson from Rock CC's Facebook group post",
    "caption": "Rock CC Facebook group — public post naming Thomas Parkinson",
    "confidence": "high",
    "warnings": [
      "This page sits behind a login wall — open it in a browser where you're signed into the platform to see the post and any photos."
    ]
  }
}`,
      inputSchema: renderImageInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; no async work here.
      execute: async ({ image }: { image: ImageSpec }) => {
        const id = randomUUID();
        writer.write({
          type: "data-image",
          id,
          data: image,
        });
        // Short receipt for the LLM. The image payload is already streaming
        // to the client via the data part above.
        return {
          rendered: true,
          imageId: id,
          imageUrl: image.imageUrl,
        };
      },
    }),
  };
}

export type RenderImageTools = ReturnType<typeof createRenderImageTool>;
