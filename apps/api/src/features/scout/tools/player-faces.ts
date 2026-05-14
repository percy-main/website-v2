import {
  playerFacesSpecSchema,
  type PlayerFacesSpec,
} from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface PlayerFacesToolDeps {
  // Same writer pattern as chart_render / render_video / render_image —
  // the route wraps streamText in a createUIMessageStream and hands the
  // writer down so this tool can emit a data-player-faces part inline
  // with the assistant's prose.
  writer: UIMessageStreamWriter;
}

// Anthropic requires every tool's input_schema to be an OBJECT at the top
// level. Wrap the spec in `{ playerFaces: ... }` to match the other
// render tools.
const playerFacesInputSchema = z.object({
  playerFaces: playerFacesSpecSchema,
});

export function createPlayerFacesTool(deps: PlayerFacesToolDeps) {
  const { writer } = deps;

  return {
    player_faces: tool({
      description: `Surface a recognition-source card for ONE named player. The card leads with the player's name + a confidence chip, shows the detected face thumbnails up front, and tucks the full source images + 'view source' links behind a 'show source images' toggle.

PREFER THIS over render_image whenever you have face-bearing recognition results. Faces are the headline — render_image only shows the full photo, which is more cognitive load when the captain just wants to see who they're looking for. Reach for render_image only when the candidate has an imageUrl but NO faces (e.g. a logo / banner image surfaced by the recognition tool but skipped by the face detector), OR for any non-recognition image rendering.

When to call player_faces:
- find_player_photo_sources returned ≥1 candidate with a non-empty faces[] array for this player.
- You're answering "find me a picture of X" or similar recognition asks.

When NOT to call:
- The candidate has no faces[] (face detector found nothing → it's not a useful player photo). Don't pass these to player_faces. Mention the source in prose if you must, or just drop it.
- The candidate has no imageUrl (page-only lead). Link the page in prose.
- The captain didn't ask about recognition — keep prose for general image rendering.

GROUPING — one player_faces call per PLAYER. If find_player_photo_sources was called once with N face-bearing candidates for one player, that's one player_faces call with N entries in sources[]. Don't call player_faces multiple times for the same player; don't batch unrelated players into one call.

CONFIDENCE — pick the BEST level across the sources you're including. If any source was high, the card's confidence is high. If the mix is medium + low, the card is medium. If everything is low, the card is low.

Inputs (wrap in { "playerFaces": {...} }):
- playerName — REQUIRED. The named player.
- confidence — "high" | "medium" | "low". See above.
- sources — REQUIRED. Array of { imageUrl, sourceUrl, alt, caption, warnings, faces }. Pass-through from the recognition candidates verbatim (especially faces[] and warnings[]). At least one source; up to 8.

NEVER invent face URLs, image URLs, or source URLs — only pass values the recognition tool returned. NEVER include sources whose faces[] is empty or missing.

EXAMPLE — single source, login-walled FB candidate:
{
  "playerFaces": {
    "playerName": "Thomas Parkinson",
    "confidence": "high",
    "sources": [
      {
        "imageUrl": "https://scontent.fb.com/.../photo.jpg",
        "sourceUrl": "https://www.facebook.com/groups/.../posts/...",
        "alt": "Candidate photo of Thomas Parkinson from Rock CC's Facebook group",
        "caption": "Rock CC Facebook group",
        "warnings": [
          "This page sits behind a login wall — open it in a browser where you're signed into the platform to see the post and any photos."
        ],
        "faces": [
          { "url": "https://signed.s3/face1.jpg", "width": 320, "height": 240 },
          { "url": "https://signed.s3/face2.jpg", "width": 320, "height": 240 }
        ]
      }
    ]
  }
}`,
      inputSchema: playerFacesInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; no async work here.
      execute: async ({ playerFaces }: { playerFaces: PlayerFacesSpec }) => {
        const id = randomUUID();
        writer.write({
          type: "data-player-faces",
          id,
          data: playerFaces,
        });
        // Short receipt for the LLM — the data part is already streaming.
        return {
          rendered: true,
          cardId: id,
          playerName: playerFaces.playerName,
          confidence: playerFaces.confidence,
          sourceCount: playerFaces.sources.length,
          faceCount: playerFaces.sources.reduce(
            (n, s) => n + s.faces.length,
            0,
          ),
        };
      },
    }),
  };
}

export type PlayerFacesTools = ReturnType<typeof createPlayerFacesTool>;
