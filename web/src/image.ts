/**
 * image.ts — turn whatever the user dropped into a baseline JPEG at the badge's size.
 *
 * The badge panel is round and reports its size (368×368 on DZBJ-TV07). We cover-fit
 * the source into that square (crop, never letterbox — black corners look terrible on a
 * round display) and export with `canvas.toBlob("image/jpeg", q)`. Browsers emit
 * baseline, 4:2:0 JPEGs, which the badge decodes fine (the Python tool sends 4:4:4 and
 * the badge is happy with either). Quality 0.7 lands a 368 px still at ~25 KB; the
 * vendor app's 1.0 is ~130 KB for no visible gain.
 */

export interface PreparedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  quality: number;
  /** Object URL of the JPEG for previewing exactly what will be sent. */
  previewUrl: string;
}

export const DEFAULT_QUALITY = 0.7;

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Draw `bitmap` cover-fitted into a width×height canvas. */
export function drawCover(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh);
  return canvas;
}

export async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("canvas.toBlob returned null");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function prepareImage(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<PreparedImage> {
  const canvas = drawCover(bitmap, width, height);
  const jpeg = await encodeJpeg(canvas, quality);
  const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
  return { jpeg, width, height, quality, previewUrl };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** The badge counts free space in whole KB, rounding the image up. */
export function neededKb(bytes: number): number {
  return Math.ceil((bytes + 36) / 1024);
}
