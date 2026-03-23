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
export function createS3Uploader(config: Config): S3Uploader | null {
  if (!config.S3_BUCKET) return null;

  const client = new S3Client({ region: config.S3_REGION });
  const bucket = config.S3_BUCKET;
  const prefix = config.S3_RECEIPT_PREFIX;

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

      return `https://${bucket}.s3.${config.S3_REGION}.amazonaws.com/${key}`;
    },
  };
}
