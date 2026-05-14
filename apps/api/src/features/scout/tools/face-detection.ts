import {
  DetectFacesCommand,
  RekognitionClient,
  type BoundingBox,
} from "@aws-sdk/client-rekognition";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

/**
 * Face-detection + cropping for Scout's recognition-source pipeline.
 *
 * Privacy posture (carries forward from ADR 042): this is face DETECTION
 * (bounding boxes only), NOT face recognition / identity matching. We crop
 * faces out of a public team / match photo so the captain can study them
 * before a fixture — same affordance they'd get manually screenshotting the
 * photo themselves, just automated.
 *
 * Pipeline per source image:
 *   1. Fetch the image with a realistic UA (FB / IG CDNs reject bare fetch).
 *   2. Run AWS Rekognition DetectFaces on the bytes (≤5MB budget).
 *   3. For each face's bounding box, sharp-crop with 20% padding so the
 *      output isn't a tight chin-to-hairline crop.
 *   4. Upload each crop to the scout-attachments bucket under a faces/
 *      prefix; return a signed GET URL (30-min TTL via the request signer).
 *
 * The module is fail-soft: any per-image failure (fetch 403, Rekognition
 * "no faces", sharp error) returns an empty array. The recognition tool
 * surfaces the candidate either way; faces are an enhancement, not a gate.
 */

// Rekognition DetectFaces accepts Bytes up to 5MB. Larger images either go
// via S3 (a round-trip we don't need) or get rejected. Cap fetches well
// below the limit so we have headroom for transcoding.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
// Realistic UA + Accept headers. Some CDNs (FB scontent.* in particular)
// serve a 403/login-wall HTML when the UA looks like a bot.
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept: "image/avif,image/webp,image/jxl,image/jpeg,image/png,image/*;q=0.8",
};
// Pad each Rekognition bounding box by 20% on each side so crops carry
// hair/chin context — tight chin-to-hairline boxes are unhelpful for
// recognition. Clamp to image bounds.
const CROP_PADDING_RATIO = 0.2;
// Cap thumbnail width so the FE grid stays light; preserves aspect ratio.
const THUMBNAIL_MAX_WIDTH = 320;
const SIGNED_URL_EXPIRY_SECONDS = 30 * 60;
const REKOGNITION_MAX_FACES = 100;

export interface FaceCrop {
  /** Signed GET URL to the cropped face JPEG in scout-attachments S3. */
  url: string;
  /** Crop pixel width (post sharp resize). */
  width: number;
  /** Crop pixel height (post sharp resize). */
  height: number;
}

export interface FaceDetector {
  /**
   * Fetch + detect + crop + upload. Tri-state return:
   *   - FaceCrop[] (non-empty) — Rekognition ran, found faces, crops uploaded
   *   - []                     — Rekognition ran successfully and definitively
   *                              found zero faces (probably a logo / banner /
   *                              non-photo). Callers can use this to drop
   *                              the candidate.
   *   - null                   — couldn't tell (fetch 403, Rekognition errored,
   *                              detector latched off after creds error, etc.).
   *                              Callers should treat the candidate as
   *                              unprocessed and surface it as-is.
   */
  detectAndCrop(imageUrl: string): Promise<FaceCrop[] | null>;
}

export interface CreateFaceDetectorOpts {
  rekognition: RekognitionClient;
  s3: S3Client;
  bucket: string;
  /** S3 key prefix for the uploaded face crops (e.g. "scout/attachments/faces"). */
  prefix: string;
  logger?: FastifyBaseLogger;
}

// AWS error names that indicate a credentials / auth problem rather than a
// transient or per-image fault. When we see one of these we permanently
// disable face detection for the rest of the process — there's no point
// hammering Rekognition with bad creds and there's no point spamming the
// log on every recognition call.
const CREDS_ERROR_NAMES = new Set([
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "InvalidClientTokenId",
  "ExpiredTokenException",
  "ExpiredToken",
  "CredentialsProviderError",
  "NoCredentialProviders",
]);

function isCredsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string };
  return typeof e.name === "string" && CREDS_ERROR_NAMES.has(e.name);
}

export function createFaceDetector(opts: CreateFaceDetectorOpts): FaceDetector {
  const { rekognition, s3, bucket, prefix, logger } = opts;

  // Latched flag: once Rekognition (or S3) returns a creds-class error we
  // short-circuit every subsequent call. Cleared only by restarting the
  // process — which is exactly what you'd do after rotating creds in
  // local dev anyway.
  let disabled = false;

  return {
    async detectAndCrop(imageUrl: string): Promise<FaceCrop[] | null> {
      const TOOL = "scout face detection";
      if (disabled) return null;

      // 1. Fetch the source image.
      let bytes: Buffer;
      try {
        bytes = await fetchImageBytes(imageUrl);
      } catch (err) {
        logger?.warn(
          { tool: TOOL, imageUrl, err: describeError(err) },
          "scout faces: fetch failed",
        );
        return null;
      }

      // 2. Inspect dimensions; Rekognition needs to know the source bounds
      //    to translate normalized box coords into pixel coords for sharp.
      let dims: { width: number; height: number };
      try {
        const meta = await sharp(bytes).metadata();
        if (!meta.width || !meta.height) {
          throw new Error("missing width/height");
        }
        dims = { width: meta.width, height: meta.height };
      } catch (err) {
        logger?.warn(
          { tool: TOOL, imageUrl, err: describeError(err) },
          "scout faces: image metadata read failed",
        );
        return null;
      }

      // 3. Rekognition DetectFaces.
      let boxes: BoundingBox[];
      try {
        const res = await rekognition.send(
          new DetectFacesCommand({
            Image: { Bytes: bytes },
            // Rekognition defaults to "DEFAULT" attributes which already
            // include BoundingBox. We don't need ALL (age, emotion, etc.)
            // and they're not cheap.
            Attributes: ["DEFAULT"],
          }),
        );
        boxes = (res.FaceDetails ?? [])
          .map((f) => f.BoundingBox)
          .filter((b): b is BoundingBox => Boolean(b))
          .slice(0, REKOGNITION_MAX_FACES);
      } catch (err) {
        if (isCredsError(err)) {
          disabled = true;
          logger?.warn(
            { tool: TOOL, err: describeError(err) },
            "scout faces: AWS credentials rejected by Rekognition — disabling face detection for the rest of this process. Local dev: stop pnpm dev, run `aws sso login --profile percy-main` (or fix the percy-main profile), then restart — scripts/dev.sh validates and exports AWS_PROFILE for you. Prod: check the API task role grants rekognition:DetectFaces (see ADR 042 + ecs-service IAM).",
          );
        } else {
          logger?.warn(
            { tool: TOOL, imageUrl, err: describeError(err) },
            "scout faces: rekognition failed",
          );
        }
        return null;
      }

      // Definitive zero: Rekognition ran successfully and found no faces.
      // Caller uses [] (vs null above) to mean "drop this candidate".
      if (boxes.length === 0) {
        logger?.debug(
          { tool: TOOL, imageUrl },
          "scout faces: no faces detected",
        );
        return [];
      }

      logger?.debug(
        { tool: TOOL, imageUrl, faceCount: boxes.length },
        "scout faces: detected",
      );

      // 4. Crop + upload in parallel.
      const crops = await Promise.all(
        boxes.map(async (box, i) => {
          try {
            const region = pixelRegion(box, dims);
            if (!region) return null;
            const cropped = await sharp(bytes)
              .extract(region)
              .resize({
                width: THUMBNAIL_MAX_WIDTH,
                withoutEnlargement: true,
              })
              .jpeg({ quality: 85 })
              .toBuffer({ resolveWithObject: true });
            const key = `${prefix}/${randomUUID()}.jpg`;
            await s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: cropped.data,
                ContentType: "image/jpeg",
                CacheControl: "private, max-age=1800",
              }),
            );
            const url = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: bucket, Key: key }),
              { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
            );
            return {
              url,
              width: cropped.info.width,
              height: cropped.info.height,
            } satisfies FaceCrop;
          } catch (err) {
            if (isCredsError(err)) {
              disabled = true;
              logger?.warn(
                { tool: TOOL, err: describeError(err) },
                "scout faces: AWS credentials invalid (S3 upload) — disabling face detection for the rest of this process.",
              );
              return null;
            }
            logger?.warn(
              {
                tool: TOOL,
                imageUrl,
                faceIndex: i,
                err: describeError(err),
              },
              "scout faces: crop / upload failed",
            );
            return null;
          }
        }),
      );

      const uploaded = crops.filter((c): c is FaceCrop => c !== null);
      // Rekognition saw faces but every crop / upload failed → we know
      // there ARE faces but can't surface them. Treat as null (caller
      // should not drop the candidate) rather than [] (definitive zero).
      if (uploaded.length === 0) {
        logger?.warn(
          { tool: TOOL, imageUrl, detectedBoxes: boxes.length },
          "scout faces: rekognition saw faces but all crops failed",
        );
        return null;
      }
      logger?.info(
        {
          tool: TOOL,
          imageUrl,
          requested: boxes.length,
          uploaded: uploaded.length,
        },
        "scout faces: done",
      );
      return uploaded;
    },
  };
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`unexpected content-type: ${contentType || "unknown"}`);
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error(`image too large: ${contentLength} bytes`);
    }
    const arr = new Uint8Array(await res.arrayBuffer());
    if (arr.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`image too large after fetch: ${arr.byteLength} bytes`);
    }
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Translate Rekognition's normalized BoundingBox (0..1 floats relative to
 * image dims) into a sharp .extract() pixel region, with padding and
 * clamping so we never request a region outside the image. Returns null
 * when the resulting region is degenerate (zero-sized after clamping).
 */
function pixelRegion(
  box: BoundingBox,
  dims: { width: number; height: number },
): PixelRegion | null {
  const W = dims.width;
  const H = dims.height;
  const bw = (box.Width ?? 0) * W;
  const bh = (box.Height ?? 0) * H;
  if (bw <= 0 || bh <= 0) return null;
  const padX = bw * CROP_PADDING_RATIO;
  const padY = bh * CROP_PADDING_RATIO;
  const left = Math.max(0, Math.round((box.Left ?? 0) * W - padX));
  const top = Math.max(0, Math.round((box.Top ?? 0) * H - padY));
  const right = Math.min(
    W,
    Math.round(((box.Left ?? 0) + (box.Width ?? 0)) * W + padX),
  );
  const bottom = Math.min(
    H,
    Math.round(((box.Top ?? 0) + (box.Height ?? 0)) * H + padY),
  );
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function describeError(err: unknown): {
  message: string;
  name?: string;
  status?: number;
} {
  if (err instanceof Error) {
    const status = (err as unknown as { status?: unknown }).status;
    return {
      name: err.name,
      message: err.message,
      status: typeof status === "number" ? status : undefined,
    };
  }
  return { message: String(err) };
}
