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

/**
 * Two-bucket store for the Scout knowledge base. Mirrors the attachment
 * store pattern (s3-scout-attachments.ts):
 *
 *   uploads bucket — browser PUTs straight to S3 via a pre-signed URL,
 *                    24h lifecycle on the bucket sweeps orphans.
 *   permanent bucket — worker copies the verified upload here, keyed by
 *                    document id; objects live until the doc is deleted.
 */
export interface S3KnowledgeBaseStore {
  /** Pre-sign a PUT URL for browser-direct upload to the uploads bucket. */
  getSignedUploadUrl: (
    documentId: string,
    extension: string,
    contentType: string,
    expiresInSeconds: number,
  ) => Promise<{ uploadUrl: string; pendingKey: string }>;

  /** HEAD the uploads-bucket object. Returns null if it doesn't exist. */
  headPending: (pendingKey: string) => Promise<PendingHead | null>;

  /** Download the uploads-bucket object as a Buffer (worker side). */
  getPending: (pendingKey: string) => Promise<Buffer>;

  /** Copy from uploads bucket to permanent KB bucket. */
  copyToPermanent: (
    pendingKey: string,
    documentId: string,
    extension: string,
    contentType: string,
  ) => Promise<string>;

  /** Server-side copy from any source bucket+key into the KB permanent
   *  bucket. Used by the Track 1 bridge so attachment bytes can land in
   *  the KB without round-tripping through the uploads bucket. */
  copyFromExternal: (
    sourceBucket: string,
    sourceKey: string,
    documentId: string,
    extension: string,
    contentType: string,
  ) => Promise<string>;

  /** Download a permanent-bucket object as a Buffer (worker side, used
   *  during re-ingestion when the original bytes need re-processing). */
  getDocument: (s3Key: string) => Promise<Buffer>;

  deletePending: (pendingKey: string) => Promise<void>;
  deleteDocument: (s3Key: string) => Promise<void>;

  /** Pre-sign a GET URL for the permanent bucket (admin download). */
  getSignedDocumentUrl: (s3Key: string, contentType: string) => Promise<string>;
}

export function createS3KnowledgeBaseStore(
  config: Config,
): S3KnowledgeBaseStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const uploadsBucket = config.SCOUT_KB_UPLOADS_BUCKET;
  const permanentBucket = config.SCOUT_KB_BUCKET;
  const prefix = config.SCOUT_KB_PREFIX;

  return {
    async getSignedUploadUrl(
      documentId,
      extension,
      contentType,
      expiresInSeconds,
    ) {
      const pendingKey = `pending/${documentId}.${extension}`;
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
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async copyToPermanent(pendingKey, documentId, extension, contentType) {
      const permanentKey = `${prefix}/${documentId}/original.${extension}`;
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

    async copyFromExternal(
      sourceBucket,
      sourceKey,
      documentId,
      extension,
      contentType,
    ) {
      const permanentKey = `${prefix}/${documentId}/original.${extension}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: permanentBucket,
          Key: permanentKey,
          CopySource: `${sourceBucket}/${sourceKey}`,
          ContentType: contentType,
          MetadataDirective: "REPLACE",
        }),
      );
      return permanentKey;
    },

    async getDocument(s3Key) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: permanentBucket, Key: s3Key }),
      );
      if (!res.Body) {
        throw new Error(`No body returned for permanent key ${s3Key}`);
      }
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async deletePending(pendingKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: uploadsBucket, Key: pendingKey }),
      );
    },

    async deleteDocument(s3Key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: permanentBucket, Key: s3Key }),
      );
    },

    async getSignedDocumentUrl(s3Key, contentType) {
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

export const noopS3KnowledgeBaseStore: S3KnowledgeBaseStore = {
  getSignedUploadUrl() {
    throw new Error("Scout KB store not configured in test");
  },
  headPending() {
    throw new Error("Scout KB store not configured in test");
  },
  getPending() {
    throw new Error("Scout KB store not configured in test");
  },
  copyToPermanent() {
    throw new Error("Scout KB store not configured in test");
  },
  copyFromExternal() {
    throw new Error("Scout KB store not configured in test");
  },
  getDocument() {
    throw new Error("Scout KB store not configured in test");
  },
  deletePending() {
    throw new Error("Scout KB store not configured in test");
  },
  deleteDocument() {
    throw new Error("Scout KB store not configured in test");
  },
  getSignedDocumentUrl() {
    throw new Error("Scout KB store not configured in test");
  },
};
