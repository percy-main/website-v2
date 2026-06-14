import { videoSpecSchema, type VideoSpec } from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface RenderVideoToolDeps {
  // Same writer pattern as chart_render — the route wraps streamText in a
  // createUIMessageStream and hands the writer down so this tool can emit a
  // data-video part inline with the assistant's prose.
  writer: UIMessageStreamWriter;
}

// Anthropic requires every tool's input_schema to be an OBJECT at the top
// level. Wrap the spec in a `{ video: ... }` envelope to match chart_render.
const renderVideoInputSchema = z.object({
  video: videoSpecSchema,
});

export function createRenderVideoTool(deps: RenderVideoToolDeps) {
  const { writer } = deps;

  return {
    render_video: tool({
      description: `Render a YouTube video player inline in the chat at a specific moment. The frontend embeds the player at \`startSeconds\` so the captain hits play and immediately sees the delivery you're talking about — no new tab, no scrubbing, no copy-paste.

When to render:
- The captain asked to see a moment from a live-scored match (e.g. "show me my hundred", "the wicket ball", "the partnership winner").
- A ball-by-ball query (match_ball joined to match_stream via db_run_sql) returned rows with a \`video_id\` AND a \`ball_offset_seconds\` for the ball you want to highlight.
- You're calling out 1–3 specific deliveries and an embedded clip is more useful than a YouTube URL the user has to click.

When NOT to render:
- You don't have a real \`video_id\` from match_stream — never invent one. If \`ball_offset_seconds\` is null the match wasn't live-streamed; say so in prose instead.
- Aggregate / cross-match questions ("his dot-ball % this season") — use a chart or table.
- You're rendering more than ~3 clips in one reply. Pick the most interesting moments rather than embedding every ball.

Inputs:
- \`videoId\` — REQUIRED. The 11-character YouTube id (e.g. "cu4A54DjCDI"), not a full URL.
- \`startSeconds\` — usually \`match_ball.ball_offset_seconds\` for the delivery you're highlighting. Subtract a few seconds if you want a run-up rather than a hard cut to the moment of impact.
- \`endSeconds\` — optional clip end. Useful for an over or a short passage of play (e.g. start at the wicket-ball offset, end ~12 seconds later).
- \`title\` — one short line shown above the player. Lead with the cricket context, not the URL: "The hundred — over 34, ball 1" reads better than "Highlight clip".
- \`caption\` — one short line below the player (sample, source, anything that doesn't fit the title).

After rendering, still write the surrounding prose. The clip supplements your analysis; it doesn't replace it. Don't describe what the user is about to see in detail — call out the takeaway and let the video do the rest.

EXAMPLE — a single ball deep-link:
{
  "video": {
    "videoId": "cu4A54DjCDI",
    "startSeconds": 1843,
    "title": "The hundred — over 34, ball 1",
    "caption": "Worked Degwekar for two to bring up the ton off 91 balls."
  }
}

EXAMPLE — a short clipped passage:
{
  "video": {
    "videoId": "cu4A54DjCDI",
    "startSeconds": 1830,
    "endSeconds": 1872,
    "title": "Hundred-and-out: balls 91–93"
  }
}`,
      inputSchema: renderVideoInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool has no async work to do.
      execute: async ({ video }: { video: VideoSpec }) => {
        const id = randomUUID();
        writer.write({
          type: "data-video",
          id,
          data: video,
        });
        // Short receipt for the LLM. The actual video payload is already
        // streaming to the client via the data part above.
        return {
          rendered: true,
          videoId: id,
          startSeconds: video.startSeconds ?? null,
          endSeconds: video.endSeconds ?? null,
        };
      },
    }),
  };
}

export type RenderVideoTools = ReturnType<typeof createRenderVideoTool>;
