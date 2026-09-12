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

/**
 * The encoded form of one entry. A still has one frame; a GIF has one per GIF frame, all
 * framed and encoded identically. `previewUrl` is the first frame, for thumbnails.
 */
export interface PreparedImage {
  frames: Uint8Array[];
  /** Sum of all frame byte lengths — what free-space accounting cares about. */
  bytes: number;
  width: number;
  height: number;
  quality: number;
  previewUrl: string;
}

/** Decoded source: one bitmap per frame plus each frame's display time (ms). */
export interface SourceFrames {
  frames: ImageBitmap[];
  durationsMs: number[];
}

export const DEFAULT_QUALITY = 0.7;

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/**
 * Decode a file into frames. Animated images (GIF, animated WebP/PNG) come apart into
 * every frame with its duration via WebCodecs' ImageDecoder, which Chrome has had since
 * 94 — acceptable, since Web Bluetooth already makes this a Chrome/Edge-only app.
 * Anything else, or a browser without ImageDecoder, is a single frame.
 *
 * A GIF therefore is just a "funny shaped image": one entry, one crop, one quality, N
 * frames. The upload panels decide how the frames travel (see upload-progress.ts).
 */
export async function decodeFrames(file: Blob): Promise<SourceFrames> {
  const Decoder = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
  if (Decoder && (await Decoder.isTypeSupported(file.type))) {
    const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (count > 1) {
      const frames: ImageBitmap[] = [];
      const durationsMs: number[] = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        frames.push(await createImageBitmap(image));
        durationsMs.push(Math.max(20, Math.round((image.duration ?? 100_000) / 1000))); // µs → ms
        image.close();
      }
      decoder.close();
      return { frames, durationsMs };
    }
    decoder.close();
  }
  return { frames: [await createImageBitmap(file)], durationsMs: [0] };
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
  source: ImageBitmap | ImageBitmap[],
  width: number,
  height: number,
  quality: number,
  view: View = IDENTITY_VIEW,
): Promise<PreparedImage> {
  const bitmaps = Array.isArray(source) ? source : [source];
  const frames: Uint8Array[] = [];
  for (const b of bitmaps) frames.push(await encodeJpeg(render(b, width, height, view), quality));
  const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(frames[0]!)], { type: "image/jpeg" }));
  return { frames, bytes: frames.reduce((n, f) => n + f.length, 0), width, height, quality, previewUrl };
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
