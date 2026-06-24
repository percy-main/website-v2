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

// Derived from the generated OpenAPI types per house rule.
export type UploadedProfilePhoto =
  paths["/api/profile/edit/photo"]["post"]["responses"][200]["content"]["application/json"];

/**
 * Self-service profile photo upload: presign -> browser PUT of the original
 * -> confirm (the API decodes, strips EXIF, builds the responsive ladder).
 * Mirrors {@link uploadContentImage} but hits the profile-owner endpoints,
 * which are gated on owning an editable profile rather than a content role.
 */
export async function uploadProfilePhoto(
  file: File,
): Promise<UploadedProfilePhoto> {
  const contentType = file.type;
  if (!isUploadableType(contentType)) {
    throw new Error("Use a JPEG, PNG or WebP image");
  }

  const presigned = await callApi(
    api.POST("/api/profile/edit/photo-upload-url", {
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

  return await callApi(
    api.POST("/api/profile/edit/photo", {
      body: {
        imageId: presigned.imageId,
        pendingKey: presigned.pendingKey,
        consentConfirmed: true,
        alt: null,
      },
    }),
  );
}
