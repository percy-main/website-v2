/**
 * Compress an image file to a data URL with size and dimension constraints.
 */
export async function compressImage(
  file: File,
  options: { maxDimension: number; maxBytes: number },
): Promise<string> {
  const { maxDimension, maxBytes } = options;

  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error("Failed to load image");
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  ctx.drawImage(img, 0, 0, width, height);

  // Try progressively lower quality until under maxBytes
  let quality = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (dataUrl.length > maxBytes && quality > 0.1) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return dataUrl;
}
