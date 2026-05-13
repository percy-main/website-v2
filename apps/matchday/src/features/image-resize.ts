/**
 * Client-side image resize before upload.
 *
 * Receipt photos coming off a phone camera are often 4-8 MB and the API
 * accepts a base64 data URL — naively uploading that over patchy 4G kills
 * the captain's flow. We resize to at most 1600px on the longest edge
 * and re-encode as JPEG at 0.82 quality. Returns the data: URL.
 *
 * Falls back to the original data URL if the browser can't decode the
 * blob (e.g. an obscure HEIC variant); the server-side validator will
 * still gate on format.
 */
export async function resizeImageForUpload(
  file: File,
  maxEdge = 1600,
  quality = 0.82,
): Promise<string> {
  const bitmap = await tryDecode(file);
  if (!bitmap) return await fileToDataUrl(file);

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return await fileToDataUrl(file);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

async function tryDecode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      resolve(typeof r === "string" ? r : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
