import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const SIGNED_URL_EXPIRY_SECONDS = 30 * 60; // 30 minutes

export interface UploadDocumentParams {
  pdfBytes: Buffer;
  documentId: string;
  version: number;
}

export interface S3DocumentStore {
  uploadDocument: (params: UploadDocumentParams) => Promise<string>;
  getSignedDocumentUrl: (s3Key: string) => Promise<string>;
}

/**
 * Creates an S3 document store for policy document PDFs.
 * Uploads PDFs and generates time-limited signed GET URLs.
 */
export function createS3DocumentStore(config: Config): S3DocumentStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };

  // LocalStack or other S3-compatible endpoints
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const bucket = config.S3_DOCUMENTS_BUCKET;
  const prefix = config.S3_DOCUMENTS_PREFIX;

  return {
    async uploadDocument({ pdfBytes, documentId, version }) {
      if (pdfBytes.byteLength > MAX_SIZE_BYTES) {
        throw Object.assign(
          new Error("Document is too large. Maximum size is 10MB"),
          { statusCode: 400 },
        );
      }

      const key = `${prefix}/${documentId}/v${version}.pdf`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: pdfBytes,
          ContentType: "application/pdf",
        }),
      );

      return key;
    },

    async getSignedDocumentUrl(s3Key: string) {
      const command = new GetObjectCommand({
        Bucket: bucket,
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
 * No-op document store for tests where no documents are uploaded.
 */
export const noopS3DocumentStore: S3DocumentStore = {
  uploadDocument() {
    throw new Error("S3 document store not configured in test");
  },
  getSignedDocumentUrl() {
    throw new Error("S3 document store not configured in test");
  },
};
