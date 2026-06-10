import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.ts";
import type {
  ContentImageStore,
  PendingImageHead,
} from "../../lib/s3-content-images.ts";
import { confirmUpload, createUploadUrl, processImage } from "./service.ts";

const config = {
  CONTENT_IMAGE_MAX_BYTES: 10 * 1024 * 1024,
  CONTENT_IMAGE_UPLOAD_URL_EXPIRY_SECONDS: 900,
} as Config;

function makeStore(
  overrides: Partial<ContentImageStore> = {},
): ContentImageStore {
  return {
    getSignedUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: "https://s3.example/put?sig=1",
      pendingKey: "content-images/pending/img-1.jpg",
    }),
    headPending: vi
      .fn()
      .mockResolvedValue({ contentLength: 100, contentType: "image/jpeg" }),
    getPending: vi.fn(),
    putVariant: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 120, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("processImage", () => {
  it("builds the full ladder for a large image", async () => {
    const original = await makeJpeg(2400, 1600);
    const result = await processImage(original, "img-1", "uploads/content");

    // WebP-only ladder: AVIF is deliberately absent (too slow to encode
    // synchronously on the 0.25 vCPU API task - ADR 048).
    expect(result.variants.some((v) => v.format === "avif")).toBe(false);
    const webpWidths = result.variants
      .filter((v) => v.format === "webp")
      .map((v) => v.width);
    expect(webpWidths).toEqual([320, 640, 960, 1280, 1920]);

    // Fallback at the largest ladder width in the original format
    const fallback = result.variants.find((v) => v.format === "jpeg");
    expect(fallback?.width).toBe(1920);
    expect(fallback?.key).toBe("uploads/content/img-1/1920.jpg");

    expect(result.picture.img.src).toBe("/uploads/content/img-1/1920.jpg");
    expect(result.picture.sources.avif).toBeUndefined();
    expect(result.picture.sources.webp).toContain(
      "/uploads/content/img-1/320.webp 320w",
    );
    expect(result.width).toBe(2400);
    expect(result.height).toBe(1600);
  });

  it("never upscales a small image", async () => {
    const original = await makeJpeg(500, 400);
    const result = await processImage(original, "img-2", "uploads/content");

    const widths = result.variants.map((v) => v.width);
    expect(Math.max(...widths)).toBeLessThanOrEqual(500);
    expect(
      result.variants.filter((v) => v.format === "webp").map((v) => v.width),
    ).toEqual([320]);
  });

  it("rejects non-image bytes", async () => {
    await expect(
      processImage(Buffer.from("not an image"), "img-3", "uploads/content"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects decodable-but-unsupported formats", async () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );
    await expect(
      processImage(gif, "img-4", "uploads/content"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("createUploadUrl", () => {
  it("issues a presigned URL with the size cap", async () => {
    const store = makeStore();
    const result = await createUploadUrl(
      store,
      config,
    )({
      contentType: "image/jpeg",
    });
    expect(result.uploadUrl).toContain("https://");
    expect(result.maxBytes).toBe(config.CONTENT_IMAGE_MAX_BYTES);
    expect(result.imageId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("confirmUpload", () => {
  const imageId = "5a0f9c4e-3b6f-4af3-9f30-3d6a52e3b111";

  /** Mock DB whose content_image lookup resolves to `existingRow`. */
  function makeDb(existingRow?: Record<string, unknown>) {
    const executeTakeFirst = vi.fn().mockResolvedValue(existingRow);
    const builder = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst,
    };
    return builder as unknown as Kysely<DB>;
  }

  const db = makeDb();

  it("rejects a pendingKey that does not match the imageId", async () => {
    const store = makeStore();
    await expect(
      confirmUpload(
        db,
        store,
        config,
      )({
        imageId,
        pendingKey: "content-images/pending/other-image.jpg",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a pendingKey outside the pending prefix", async () => {
    const store = makeStore();
    await expect(
      confirmUpload(
        db,
        store,
        config,
      )({
        imageId,
        pendingKey: `receipts/${imageId}.jpg`,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s when the pending object is missing", async () => {
    const store = makeStore({
      headPending: vi.fn().mockResolvedValue(null),
    });
    await expect(
      confirmUpload(
        db,
        store,
        config,
      )({
        imageId,
        pendingKey: `content-images/pending/${imageId}.jpg`,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects and deletes an oversized pending object", async () => {
    const deletePending = vi.fn().mockResolvedValue(undefined);
    const store = makeStore({
      headPending: vi.fn().mockResolvedValue({
        contentLength: config.CONTENT_IMAGE_MAX_BYTES + 1,
        contentType: "image/jpeg",
      } satisfies PendingImageHead),
      deletePending,
    });
    await expect(
      confirmUpload(
        db,
        store,
        config,
      )({
        imageId,
        pendingKey: `content-images/pending/${imageId}.jpg`,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deletePending).toHaveBeenCalled();
  });

  it("returns the registered image when the row already exists", async () => {
    // The retry-after-504 case: the first confirm finished (row written,
    // pending object deleted) but the client never saw the response.
    const picture = {
      sources: { webp: `/uploads/content/${imageId}/320.webp 320w` },
      img: { src: `/uploads/content/${imageId}/320.webp`, w: 320, h: 200 },
    };
    const headPending = vi.fn().mockResolvedValue(null);
    const store = makeStore({ headPending });

    const result = await confirmUpload(
      makeDb({
        id: imageId,
        picture,
        alt: "Crowd shot",
        width: 320,
        height: 200,
      }),
      store,
      config,
    )({
      imageId,
      pendingKey: `content-images/pending/${imageId}.jpg`,
      alt: "Crowd shot",
      userId: "user-1",
    });

    expect(result).toEqual({
      id: imageId,
      picture,
      alt: "Crowd shot",
      width: 320,
      height: 200,
    });
    // Short-circuited before ever touching S3
    expect(headPending).not.toHaveBeenCalled();
  });
});
