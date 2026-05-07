import { z } from "zod";

// Spec for the render_video tool. Currently YouTube-only; that's all the
// upstream data carries (match_stream.video_id is a YouTube id and
// match_ball.ball_offset_seconds is an offset into that video). If we ever
// add another source we'd switch this to a discriminated union on `provider`.

// YouTube video ids are 11 chars, [A-Za-z0-9_-]. Validate strictly so a
// hallucinated value (or an accidental full URL) fails fast in the tool's
// execute() rather than producing a broken iframe.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const videoSpecSchema = z
  .object({
    videoId: z
      .string()
      .regex(YOUTUBE_ID, "videoId must be an 11-character YouTube video id")
      .describe("YouTube video id, e.g. 'cu4A54DjCDI' (NOT the full URL)."),
    title: z
      .string()
      .max(140)
      .optional()
      .describe(
        "Optional one-line title shown above the player (e.g. 'The hundred — over 34, ball 1').",
      ),
    caption: z
      .string()
      .max(280)
      .optional()
      .describe(
        "Optional one-line caption shown below the player (context, source, sample-size note).",
      ),
    startSeconds: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Seconds offset to start playback from. Use match_ball.ball_offset_seconds when deep-linking a specific delivery.",
      ),
    endSeconds: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Seconds offset to stop playback at. Use to clip a short highlight (e.g. start at the dismissal ball, end ~10s later).",
      ),
  })
  .refine(
    (v) =>
      v.endSeconds === undefined ||
      v.startSeconds === undefined ||
      v.endSeconds > v.startSeconds,
    { message: "endSeconds must be greater than startSeconds." },
  );

export type VideoSpec = z.infer<typeof videoSpecSchema>;
