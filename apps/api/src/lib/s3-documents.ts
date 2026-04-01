import {
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";

const SIGNED_URL_EXPIRY_SECONDS = 30 * 60; // 30 minutes
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

export interface S3DocumentStore {
  /** Pre-sign a PUT URL for browser-direct upload to the pending bucket. */
  getSignedUploadUrl: (
    documentId: string,
    version: number,
  ) => Promise<{ uploadUrl: string; pendingKey: string }>;

  /** Copy a file from the pending uploads bucket to the permanent documents bucket. */
  copyToPermanent: (
    pendingKey: string,
    documentId: string,
    version: number,
  ) => Promise<string>;

  /** Pre-sign a GET URL for reading a document from the permanent bucket. */
  getSignedDocumentUrl: (s3Key: string) => Promise<string>;
}

/**
 * Creates an S3 document store for policy document PDFs.
 *
 * Two-bucket architecture:
 * - Upload bucket: temporary landing zone for browser-direct uploads (24h lifecycle)
 * - Documents bucket: permanent auditable store (Object Lock, no deletes)
 */
export function createS3DocumentStore(config: Config): S3DocumentStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };

  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const uploadsBucket = config.S3_DOCUMENT_UPLOADS_BUCKET;
  const documentsBucket = config.S3_DOCUMENTS_BUCKET;
  const prefix = config.S3_DOCUMENTS_PREFIX;

  return {
    async getSignedUploadUrl(documentId, version) {
      const pendingKey = `pending/${documentId}/v${version}.pdf`;

      const command = new PutObjectCommand({
        Bucket: uploadsBucket,
        Key: pendingKey,
        ContentType: "application/pdf",
      });

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
      });

      return { uploadUrl, pendingKey };
    },

    async copyToPermanent(pendingKey, documentId, version) {
      const permanentKey = `${prefix}/${documentId}/v${version}.pdf`;

      await client.send(
        new CopyObjectCommand({
          Bucket: documentsBucket,
          Key: permanentKey,
          CopySource: `${uploadsBucket}/${pendingKey}`,
          ContentType: "application/pdf",
          MetadataDirective: "REPLACE",
        }),
      );

      return permanentKey;
    },

    async getSignedDocumentUrl(s3Key) {
      const command = new GetObjectCommand({
        Bucket: documentsBucket,
        Key: s3Key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: "inline",
      });

      return await getSignedUrl(client, command, {
        expiresIn: SIGNED_URL_EXPIRY_SECONDS,
      });
    },
  };
}

/**
 * No-op document store for tests.
 */
export const noopS3DocumentStore: S3DocumentStore = {
  getSignedUploadUrl() {
    throw new Error("S3 document store not configured in test");
  },
  copyToPermanent() {
    throw new Error("S3 document store not configured in test");
  },
  getSignedDocumentUrl() {
    throw new Error("S3 document store not configured in test");
  },
};
