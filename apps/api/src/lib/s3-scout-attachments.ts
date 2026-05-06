import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";

const SIGNED_URL_EXPIRY_SECONDS = 30 * 60;

export interface PendingHead {
  contentLength: number;
  contentType: string | null;
}

export interface ScoutAttachmentStore {
  /** Pre-sign a PUT URL for browser-direct upload to the uploads bucket. */
  getSignedUploadUrl: (
    attachmentId: string,
    extension: string,
    contentType: string,
    expiresInSeconds: number,
  ) => Promise<{ uploadUrl: string; pendingKey: string }>;

  /** HEAD the uploads-bucket object. Returns null if it does not exist. */
  headPending: (pendingKey: string) => Promise<PendingHead | null>;

  /** Download the uploads-bucket object as a Buffer. */
  getPending: (pendingKey: string) => Promise<Buffer>;

  /** Copy from uploads bucket to permanent attachments bucket. */
  copyToPermanent: (
    pendingKey: string,
    threadId: string,
    attachmentId: string,
    extension: string,
    contentType: string,
  ) => Promise<string>;

  deletePending: (pendingKey: string) => Promise<void>;
  deletePermanent: (s3Key: string) => Promise<void>;

  /** Pre-sign a GET URL for the permanent bucket. */
  getSignedAttachmentUrl: (
    s3Key: string,
    contentType: string,
  ) => Promise<string>;
}

export function createScoutAttachmentStore(
  config: Config,
): ScoutAttachmentStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const uploadsBucket = config.SCOUT_ATTACHMENT_UPLOADS_BUCKET;
  const permanentBucket = config.SCOUT_ATTACHMENTS_BUCKET;
  const prefix = config.SCOUT_ATTACHMENTS_PREFIX;

  return {
    async getSignedUploadUrl(
      attachmentId,
      extension,
      contentType,
      expiresInSeconds,
    ) {
      const pendingKey = `pending/${attachmentId}.${extension}`;
      const command = new PutObjectCommand({
        Bucket: uploadsBucket,
        Key: pendingKey,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });
      return { uploadUrl, pendingKey };
    },

    async headPending(pendingKey) {
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: uploadsBucket, Key: pendingKey }),
        );
        return {
          contentLength: res.ContentLength ?? 0,
          contentType: res.ContentType ?? null,
        };
      } catch (err) {
        // SDK throws NotFound (404) when the object is missing. Translate to
        // null so callers don't have to know which error class to match on.
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async getPending(pendingKey) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: uploadsBucket, Key: pendingKey }),
      );
      if (!res.Body) {
        throw new Error(`No body returned for pending key ${pendingKey}`);
      }
      // S3 SDK v3: Body is a stream-like; transformToByteArray consolidates
      // the chunks. Wrap in a Node Buffer so callers can pass it to crypto
      // and AI SDK content blocks.
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async copyToPermanent(
      pendingKey,
      threadId,
      attachmentId,
      extension,
      contentType,
    ) {
      const permanentKey = `${prefix}/${threadId}/${attachmentId}.${extension}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: permanentBucket,
          Key: permanentKey,
          CopySource: `${uploadsBucket}/${pendingKey}`,
          ContentType: contentType,
          MetadataDirective: "REPLACE",
        }),
      );
      return permanentKey;
    },

    async deletePending(pendingKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: uploadsBucket, Key: pendingKey }),
      );
    },

    async deletePermanent(s3Key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: permanentBucket, Key: s3Key }),
      );
    },

    async getSignedAttachmentUrl(s3Key, contentType) {
      const command = new GetObjectCommand({
        Bucket: permanentBucket,
        Key: s3Key,
        ResponseContentType: contentType,
        ResponseContentDisposition: "inline",
      });
      return await getSignedUrl(client, command, {
        expiresIn: SIGNED_URL_EXPIRY_SECONDS,
      });
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

export const noopScoutAttachmentStore: ScoutAttachmentStore = {
  getSignedUploadUrl() {
    throw new Error("Scout attachment store not configured in test");
  },
  headPending() {
    throw new Error("Scout attachment store not configured in test");
  },
  getPending() {
    throw new Error("Scout attachment store not configured in test");
  },
  copyToPermanent() {
    throw new Error("Scout attachment store not configured in test");
  },
  deletePending() {
    throw new Error("Scout attachment store not configured in test");
  },
  deletePermanent() {
    throw new Error("Scout attachment store not configured in test");
  },
  getSignedAttachmentUrl() {
    throw new Error("Scout attachment store not configured in test");
  },
};
