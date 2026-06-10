import type { PictureSource } from "@/components/optimised-image.js";
import { api, callApi } from "@/lib/api-client.js";

const UPLOADABLE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

type UploadableType = (typeof UPLOADABLE_TYPES)[number];

function isUploadableType(type: string): type is UploadableType {
  return (UPLOADABLE_TYPES as readonly string[]).includes(type);
}

export interface UploadedContentImage {
  id: string;
  picture: PictureSource;
  alt: string | null;
  width: number;
  height: number;
}

/**
 * Full presigned upload flow for an editor image: presign -> browser PUT
 * of the original -> confirm (API decodes, strips EXIF, builds the
 * responsive ladder). The caller is responsible for having collected
 * photo consent; the API additionally refuses both steps without it.
 */
export async function uploadContentImage(
  file: File,
  options: { alt?: string },
): Promise<UploadedContentImage> {
  const contentType = file.type;
  if (!isUploadableType(contentType)) {
    throw new Error("Use a JPEG, PNG or WebP image");
  }

  const presigned = await callApi(
    api.POST("/api/admin/content-images/upload-url", {
      body: { contentType, consentConfirmed: true },
    }),
  );

  if (file.size > presigned.maxBytes) {
    throw new Error(
      `Image is too large - maximum size is ${String(Math.floor(presigned.maxBytes / (1024 * 1024)))}MB`,
    );
  }

  // Browser-direct PUT to S3: the one place a raw fetch is correct, the
  // target is the presigned S3 URL rather than our API.
  const putRes = await fetch(presigned.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": file.type },
  });
  if (!putRes.ok) {
    throw new Error("Upload failed - please try again");
  }

  const confirmed = await callApi(
    api.POST("/api/admin/content-images", {
      body: {
        imageId: presigned.imageId,
        pendingKey: presigned.pendingKey,
        consentConfirmed: true,
        alt: options.alt ?? null,
      },
    }),
  );

  return confirmed;
}
