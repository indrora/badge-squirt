/**
 * image.ts — turn whatever the user dropped into a baseline JPEG at the badge's size.
 *
 * The badge panel is round and reports its size (368×368 on DZBJ-TV07). The source is
 * cover-fitted into that square, then panned/zoomed by the user (see View), never
 * letterboxed — black corners look terrible on a round display — and exported with `canvas.toBlob("image/jpeg", q)`. Browsers emit
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

/**
 * How the source sits in the output square. `zoom` multiplies the cover-fit scale (1 =
 * the smallest scale that still fills the square, so no letterboxing is ever possible);
 * `dx`/`dy` pan the image in output pixels, positive = image moves right/down.
 */
export interface View {
  zoom: number;
  dx: number;
  dy: number;
}

export const IDENTITY_VIEW: View = { zoom: 1, dx: 0, dy: 0 };
export const MAX_ZOOM = 6;

/** Scale at which the bitmap exactly covers width×height (the zoom = 1 baseline). */
export function coverScale(bitmap: { width: number; height: number }, width: number, height: number): number {
  return Math.max(width / bitmap.width, height / bitmap.height);
}

/**
 * Clamp a view so the image always covers the whole square: zoom ≥ 1, and the pan may
 * not expose any background. The badge panel is round, so strictly we could allow the
 * corners to go empty, but the vendor firmware shows the full square while "Updating…"
 * and black corners look broken there.
 */
export function clampView(view: View, bitmap: { width: number; height: number }, width: number, height: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const scale = coverScale(bitmap, width, height) * zoom;
  const overX = Math.max(0, (bitmap.width * scale - width) / 2);
  const overY = Math.max(0, (bitmap.height * scale - height) / 2);
  return { zoom, dx: Math.min(overX, Math.max(-overX, view.dx)), dy: Math.min(overY, Math.max(-overY, view.dy)) };
}

/** Draw `bitmap` into `ctx` (width×height) under `view`, which must already be clamped. */
export function drawView(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, width: number, height: number, view: View): void {
  const scale = coverScale(bitmap, width, height) * view.zoom;
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (width - dw) / 2 + view.dx, (height - dh) / 2 + view.dy, dw, dh);
}

/** Render `bitmap` under `view` to a fresh canvas of the badge's size. */
export function render(bitmap: ImageBitmap, width: number, height: number, view: View = IDENTITY_VIEW): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawView(canvas.getContext("2d")!, bitmap, width, height, clampView(view, bitmap, width, height));
  return canvas;
}

export async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("canvas.toBlob returned null");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function prepareImage(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
  view: View = IDENTITY_VIEW,
): Promise<PreparedImage> {
  const canvas = render(bitmap, width, height, view);
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
