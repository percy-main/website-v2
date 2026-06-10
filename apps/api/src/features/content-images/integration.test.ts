import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../../config.ts";
import type { ContentImageStore } from "../../lib/s3-content-images.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { confirmUpload } from "./service.ts";

const config = {
  CONTENT_IMAGE_PENDING_PREFIX: "content-images/pending",
  CONTENT_IMAGES_PREFIX: "uploads/content",
  CONTENT_IMAGE_MAX_BYTES: 10 * 1024 * 1024,
  CONTENT_IMAGE_UPLOAD_URL_EXPIRY_SECONDS: 900,
} as Config;

// In-memory S3 stand-in: integration tests exercise the real DB and the
// real sharp pipeline; only the bucket is faked.
function createMemoryStore(): ContentImageStore & {
  objects: Map<string, { body: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    getSignedUploadUrl(imageId, extension) {
      const pendingKey = `content-images/pending/${imageId}.${extension}`;
      return Promise.resolve({
        uploadUrl: `https://mock-s3.example.com/${pendingKey}?presigned=true`,
        pendingKey,
      });
    },
    headPending(pendingKey) {
      const obj = objects.get(pendingKey);
      return Promise.resolve(
        obj
          ? { contentLength: obj.body.byteLength, contentType: obj.contentType }
          : null,
      );
    },
    getPending(pendingKey) {
      const obj = objects.get(pendingKey);
      if (!obj) throw new Error(`missing ${pendingKey}`);
      return Promise.resolve(obj.body);
    },
    putVariant(key, body, contentType) {
      objects.set(key, { body, contentType });
      return Promise.resolve();
    },
    deletePending(pendingKey) {
      objects.delete(pendingKey);
      return Promise.resolve();
    },
  };
}

/** A JPEG with GPS + camera EXIF, the privacy-sensitive case. */
async function makeGpsTaggedJpeg(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 1400,
      height: 900,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .withExif({
      IFD0: {
        Make: "TestCam",
        Model: "TestCam 3000",
        Copyright: "Percy Main CSC",
      },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "55/1 0/1 4200/100",
        GPSLongitudeRef: "W",
        GPSLongitude: "1/1 27/1 1800/100",
      },
    })
    .toBuffer();
}

describe("content image pipeline (integration)", () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await startTestContainer();
    ({ userId } = await seedTestUser(ctx.db, { withMember: false }));
  }, 120_000);

  afterAll(async () => {
    await stopTestContainer(ctx);
  });

  it("processes a GPS-tagged upload into clean responsive variants", async () => {
    const store = createMemoryStore();
    const original = await makeGpsTaggedJpeg();

    // Sanity: the fixture really does carry EXIF before processing
    const originalMeta = await sharp(original).metadata();
    expect(originalMeta.exif).toBeDefined();

    const imageId = crypto.randomUUID();
    const pendingKey = `content-images/pending/${imageId}.jpg`;
    store.objects.set(pendingKey, {
      body: original,
      contentType: "image/jpeg",
    });

    const result = await confirmUpload(
      ctx.db,
      store,
      config,
    )({
      imageId,
      pendingKey,
      alt: "The winning six",
      userId,
    });

    // Every variant written to the public prefix, pending cleaned up
    const keys = [...store.objects.keys()];
    expect(store.objects.has(pendingKey)).toBe(false);
    expect(keys.every((k) => k.startsWith(`uploads/content/${imageId}/`))).toBe(
      true,
    );
    // 1400px source -> 320/640/960/1280 in avif + webp, + jpeg fallback
    expect(keys).toHaveLength(9);

    // Zero EXIF/GPS metadata in every variant
    for (const [, obj] of store.objects) {
      const meta = await sharp(obj.body).metadata();
      expect(meta.exif).toBeUndefined();
    }

    // PictureSource descriptor is consumable by OptimisedImage
    expect(result.picture.img.src).toBe(`/uploads/content/${imageId}/1280.jpg`);
    expect(result.picture.sources.avif?.split(", ")).toHaveLength(4);
    expect(result.picture.sources.webp?.split(", ")).toHaveLength(4);

    // Registered in the DB with consent + audit fields
    const row = await ctx.db
      .selectFrom("content_image")
      .selectAll()
      .where("id", "=", imageId)
      .executeTakeFirstOrThrow();
    expect(row.consent_confirmed).toBe(true);
    expect(row.uploaded_by).toBe(userId);
    expect(row.alt).toBe("The winning six");
    expect(row.width).toBe(1400);
    expect(row.height).toBe(900);
  });
});
