import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";

const SIGNED_URL_EXPIRY_SECONDS = 30 * 60; // 30 minutes

export interface ScoutReportStore {
  /** Upload a generated PDF buffer for a report. Returns the S3 key. */
  putReport: (reportId: string, body: Buffer) => Promise<string>;

  /**
   * Pre-sign a GET URL for downloading a report. Sets a Content-Disposition
   * attachment with a friendly filename so the browser downloads-rather-than-
   * inlines.
   */
  getSignedReportUrl: (s3Key: string, filename: string) => Promise<string>;

  /** Delete a report object from the bucket. */
  deleteReport: (s3Key: string) => Promise<void>;
}

/**
 * Creates a store for AI-generated Scout report PDFs.
 *
 * Reports are user-private artefacts. Access is via signed GET URLs only;
 * the bucket has public access blocked and a 365-day lifecycle expiration
 * so abandoned reports get cleaned up automatically.
 */
export function createScoutReportStore(config: Config): ScoutReportStore {
  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const bucket = config.SCOUT_REPORTS_BUCKET;
  const prefix = config.SCOUT_REPORTS_PREFIX;

  return {
    async putReport(reportId, body) {
      const key = `${prefix}/${reportId}.pdf`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/pdf",
        }),
      );
      return key;
    },

    async getSignedReportUrl(s3Key, filename) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
      });
      return await getSignedUrl(client, command, {
        expiresIn: SIGNED_URL_EXPIRY_SECONDS,
      });
    },

    async deleteReport(s3Key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }),
      );
    },
  };
}

/** No-op store for tests where S3 isn't reachable. */
export const noopScoutReportStore: ScoutReportStore = {
  putReport() {
    throw new Error("Scout report store not configured in test");
  },
  getSignedReportUrl() {
    throw new Error("Scout report store not configured in test");
  },
  deleteReport() {
    throw new Error("Scout report store not configured in test");
  },
};
