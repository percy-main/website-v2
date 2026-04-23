export const MAX_LOGO_BYTES = 150_000;

export function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 300;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to create canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        for (let q = 0.8; q >= 0.1; q -= 0.1) {
          const dataUrl = canvas.toDataURL("image/jpeg", q);
          if (dataUrl.length <= MAX_LOGO_BYTES) {
            resolve(dataUrl);
            return;
          }
        }
        reject(new Error("Logo could not be compressed below 150KB"));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
