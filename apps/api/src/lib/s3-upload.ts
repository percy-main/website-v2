import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "../config.ts";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export interface UploadReceiptParams {
  imageBytes: Buffer;
  contentType: string;
  expenseId: string;
}

export interface S3Uploader {
  uploadReceipt: (params: UploadReceiptParams) => Promise<string>;
}

/**
 * Creates an S3 uploader for receipt images.
 * Returns null if S3 is not configured (e.g. local dev without S3).
 */
export function createS3Uploader(config: Config): S3Uploader {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };

  // LocalStack or other S3-compatible endpoints
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const bucket = config.S3_BUCKET;
  const prefix = config.S3_RECEIPT_PREFIX;
  const endpoint = config.S3_ENDPOINT;

  return {
    async uploadReceipt({ imageBytes, contentType, expenseId }) {
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw Object.assign(
          new Error(
            `Invalid content type: ${contentType}. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
          ),
          { statusCode: 400 },
        );
      }

      if (imageBytes.byteLength > MAX_SIZE_BYTES) {
        throw Object.assign(
          new Error("Receipt image is too large. Maximum size is 5MB"),
          { statusCode: 400 },
        );
      }

      const ext = contentType.split("/")[1];
      const key = `${prefix}/${expenseId}.${ext}`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: imageBytes,
          ContentType: contentType,
        }),
      );

      if (endpoint) {
        return `${endpoint}/${bucket}/${key}`;
      }
      return `https://${bucket}.s3.${config.S3_REGION}.amazonaws.com/${key}`;
    },
  };
}

/**
 * No-op S3 uploader for tests where no receipts are uploaded.
 * Throws if actually called — tests that exercise receipt upload
 * should use a real or mocked S3 uploader.
 */
export const noopS3Uploader: S3Uploader = {
  uploadReceipt() {
    throw new Error("S3 uploader not configured in test");
  },
};
