import { z } from "zod";

// Spec for the render_image tool. Used to surface recognition-source photos
// inline in the chat — a candidate from find_player_photo_sources turns into
// one render_image call with the source's imageUrl + sourceUrl + confidence.
//
// We accept http(s) URLs only — the FE renders the image directly, so a
// malformed scheme breaks the embed. confidence + warnings let the FE show
// the captain a labelled chip (HIGH / MEDIUM / LOW) and any caveats that
// came back from the recognition tool, so they aren't dropped on the floor.

export const imageSpecSchema = z.object({
  imageUrl: z
    .url()
    .describe(
      "Public, directly-loadable image URL. Must be http(s). Don't invent — only pass URLs the recognition tool surfaced.",
    ),
  sourceUrl: z
    .url()
    .optional()
    .describe(
      "Public page the image was found on. Rendered as a 'view source' link beneath the image so the captain can verify provenance.",
    ),
  alt: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Alt text for accessibility — describe what the image is or who it likely shows, e.g. 'Candidate photo of Thomas Parkinson from Rock CC's Facebook group post'.",
    ),
  caption: z
    .string()
    .max(280)
    .optional()
    .describe(
      "Optional one-line caption below the image. Use to attribute the source ('Rock CC Facebook group') or note context ('match recap, July 2025').",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe(
      "Confidence label, when known. Mirrors the level the recognition tool assigned to the source.",
    ),
  warnings: z
    .array(z.string().max(280))
    .max(3)
    .optional()
    .describe(
      "Caveats from the recognition tool — login-wall warnings, 'image not individually labelled', etc.",
    ),
  faces: z
    .array(
      z.object({
        url: z.url(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .max(100)
    .optional()
    .describe(
      "Optional pre-cropped face thumbnails (signed URLs), produced server-side by the recognition pipeline's face detector. The FE renders them as a small grid beneath the main image so the captain can study individual faces.",
    ),
});

export type ImageSpec = z.infer<typeof imageSpecSchema>;
