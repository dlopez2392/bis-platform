/**
 * Spec 5.3: an image is decoded and redrawn on a canvas IN THE BROWSER, orientation applied, and
 * re-encoded, which drops its GPS and camera metadata; over 4096 px on its long side it is scaled
 * down. Stated limit: a modified client can skip this; part 2's server-side pipeline is where
 * customer uploads get enforcement. HEIC never reaches here (the bucket refuses it, spec 3.1).
 */
export const MAX_IMAGE_EDGE = 4096;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function encodeArgs(type: ImageType): { type: ImageType; quality: number | undefined } {
  return { type, quality: type === "image/png" ? undefined : 0.9 };
}

/** Browser only. The Blob's own `type` is what the browser actually produced (Safari has no WebP encoder: PNG). */
export async function stripImage(file: Blob, type: ImageType): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("stripImage: no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { type: outType, quality } = encodeArgs(type);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("stripImage: encode failed"))), outType, quality));
  } finally {
    bitmap.close();
  }
}
