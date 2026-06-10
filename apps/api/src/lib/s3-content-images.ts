import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";

/**
 * Key prefixes are structural, not configuration: pending must stay
 * outside CloudFront's /uploads/* routing (so unprocessed originals are
 * never publicly served) and must match the Terraform lifecycle rule
 * that expires it (infra/modules/cdn/main.tf, expire-pending-content-images);
 * public must stay inside /uploads/* to be served at all.
 */
export const CONTENT_IMAGE_PENDING_PREFIX = "content-images/pending";
export const CONTENT_IMAGES_PREFIX = "uploads/content";

export interface PendingImageHead {
  contentLength: number;
  contentType: string | null;
}

/**
 * Store for editor-uploaded content images. Everything lives in the
 * CloudFront-served uploads bucket (S3_BUCKET): pending browser PUTs go
 * under a prefix CloudFront does not route, processed variants go under
 * uploads/content/* where they are served at /uploads/content/*.
 */
export interface ContentImageStore {
  /** Pre-sign a PUT URL for browser-direct upload of the original. */
  getSignedUploadUrl: (
    imageId: string,
    extension: string,
    contentType: string,
  ) => Promise<{ uploadUrl: string; pendingKey: string }>;

  /** HEAD the pending object. Returns null if it does not exist. */
  headPending: (pendingKey: string) => Promise<PendingImageHead | null>;

  /** Download the pending original as a Buffer. */
  getPending: (pendingKey: string) => Promise<Buffer>;

  /** Write one processed variant under the public prefix. */
  putVariant: (key: string, body: Buffer, contentType: string) => Promise<void>;

  deletePending: (pendingKey: string) => Promise<void>;
}

export function createContentImageStore(config: Config): ContentImageStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const bucket = config.S3_BUCKET;
  const pendingPrefix = CONTENT_IMAGE_PENDING_PREFIX;
  const expirySeconds = config.CONTENT_IMAGE_UPLOAD_URL_EXPIRY_SECONDS;

  return {
    async getSignedUploadUrl(imageId, extension, contentType) {
      const pendingKey = `${pendingPrefix}/${imageId}.${extension}`;
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: pendingKey,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: expirySeconds,
      });
      return { uploadUrl, pendingKey };
    },

    async headPending(pendingKey) {
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: pendingKey }),
        );
        return {
          contentLength: res.ContentLength ?? 0,
          contentType: res.ContentType ?? null,
        };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async getPending(pendingKey) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: pendingKey }),
      );
      if (!res.Body) {
        throw new Error(`No body returned for pending key ${pendingKey}`);
      }
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async putVariant(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Variants are content-addressed by image id and never rewritten,
          // so let CloudFront + browsers cache them indefinitely.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },

    async deletePending(pendingKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: pendingKey }),
      );
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

export const noopContentImageStore: ContentImageStore = {
  getSignedUploadUrl() {
    throw new Error("Content image store not configured in test");
  },
  headPending() {
    throw new Error("Content image store not configured in test");
  },
  getPending() {
    throw new Error("Content image store not configured in test");
  },
  putVariant() {
    throw new Error("Content image store not configured in test");
  },
  deletePending() {
    throw new Error("Content image store not configured in test");
  },
};
