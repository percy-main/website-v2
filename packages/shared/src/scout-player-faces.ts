import { z } from "zod";
import { httpUrlSchema } from "./url-schemas.ts";

// Spec for the player_faces tool — the richer counterpart to render_image
// for recognition-source results. One card surfaces ALL face-bearing
// sources for a single named player, with a face-thumbnail strip up top
// and the full source images tucked behind an expandable toggle.
//
// The recognition pipeline already drops candidates whose imageUrl yielded
// zero detected faces — by the time the agent assembles a player_faces
// call, every source listed here has at least one face. Don't relax that
// invariant client-side: face thumbnails ARE the value of this card.

const faceSchema = z.object({
  url: httpUrlSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const sourceSchema = z.object({
  imageUrl: httpUrlSchema.describe(
    "Full image URL (the photo the faces were cropped from). Pass-through from the recognition candidate.",
  ),
  sourceUrl: httpUrlSchema
    .optional()
    .describe(
      "Public page the image was found on. Rendered as a 'view source' link in the expanded card.",
    ),
  alt: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Alt text for the full source image — describe what it likely shows ('Rock CC Facebook group post about the 1st XI's recent match').",
    ),
  caption: z
    .string()
    .max(280)
    .optional()
    .describe(
      "One short line beneath the full source image when expanded — typically the source's name ('Rock CC Facebook group').",
    ),
  warnings: z
    .array(z.string().max(280))
    .max(3)
    .optional()
    .describe(
      "Caveats from the recognition tool — login-wall warnings, 'image not individually labelled', etc. Pass through verbatim.",
    ),
  faces: z
    .array(faceSchema)
    .min(1)
    .describe(
      "Pre-cropped face thumbnails for this source image. MUST be ≥ 1 — sources with zero detected faces aren't worth a slot in this card; render_image or a prose link is the right surface for those.",
    ),
});

export const playerFacesSpecSchema = z.object({
  playerName: z
    .string()
    .min(1)
    .max(120)
    .describe("Player the faces are for. Rendered as the card's headline."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "Best confidence level across the sources, picked from the recognition tool's per-candidate values. Rendered as a coloured chip alongside the player name.",
    ),
  sources: z
    .array(sourceSchema)
    .min(1)
    .max(8)
    .describe(
      "All face-bearing recognition sources for this player. Up to 8 per card.",
    ),
});

export type PlayerFacesSpec = z.infer<typeof playerFacesSpecSchema>;
