import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { Config } from "../config.ts";

export interface UploadTeamSheetParams {
  matchdayId: string;
  image: Buffer;
}

export interface SocialMediaUploader {
  uploadTeamSheet: (params: UploadTeamSheetParams) => Promise<string>;
}

/**
 * Creates an S3 uploader for publicly-accessible social media images.
 *
 * Keys are content-addressed: `{prefix}/{matchdayId}/{sha256(image).slice(0,12)}.png`
 * so a regenerated image with identical content reuses its URL (Meta cache-friendly),
 * while a changed image gets a new URL on retry.
 */
export function createSocialMediaUploader(config: Config): SocialMediaUploader {
  if (!config.S3_SOCIAL_MEDIA_BUCKET) {
    return {
      uploadTeamSheet() {
        throw new Error(
          "S3_SOCIAL_MEDIA_BUCKET not configured; social media uploader unavailable",
        );
      },
    };
  }

  const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
    region: config.S3_REGION,
  };
  if (config.S3_ENDPOINT) {
    clientOptions.endpoint = config.S3_ENDPOINT;
    clientOptions.forcePathStyle = true;
  }

  const client = new S3Client(clientOptions);
  const bucket = config.S3_SOCIAL_MEDIA_BUCKET;
  const prefix = config.S3_SOCIAL_MEDIA_PREFIX;
  const endpoint = config.S3_ENDPOINT;
  const region = config.S3_REGION;

  return {
    async uploadTeamSheet({ matchdayId, image }) {
      const hash = createHash("sha256")
        .update(image)
        .digest("hex")
        .slice(0, 12);
      const key = `${prefix}/${matchdayId}/${hash}.png`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: image,
          ContentType: "image/png",
          ACL: "public-read",
        }),
      );

      if (endpoint) {
        return `${endpoint}/${bucket}/${key}`;
      }
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    },
  };
}

/**
 * Stub uploader for tests — returns a deterministic fake URL and
 * does not touch S3. Tests that assert on the URL can pattern-match
 * against `https://test-bucket/...`.
 */
export const stubSocialMediaUploader: SocialMediaUploader = {
  uploadTeamSheet({ matchdayId, image }) {
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 12);
    return Promise.resolve(
      `https://test-bucket/social-media/team-sheets/${matchdayId}/${hash}.png`,
    );
  },
};
