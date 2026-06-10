import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";

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

// Derived from the generated OpenAPI types per house rule; structurally
// identical to the OptimisedImage PictureSource shape.
export type UploadedContentImage =
  paths["/api/admin/content-images"]["post"]["responses"][200]["content"]["application/json"];

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
