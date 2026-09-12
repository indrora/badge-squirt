/**
 * model.ts — the stack of pictures the user is working on.
 *
 * One ImageEntry per picture: the decoded source bitmap, the user's framing (View) and
 * quality, and the most recent encode of those (PreparedImage). The editor mutates the
 * selected entry's view/quality and re-encodes; the list shows thumbnails and sizes; the
 * upload panels read `prepared.jpeg` from every entry. ImageStore is the single source of
 * truth and tells everyone what changed through three events:
 *
 *   change   — entries added/removed/reordered (detail: entries)
 *   select   — a different entry is now selected (detail: entry | null)
 *   update   — one entry's encode finished (detail: entry)
 */

import { DEFAULT_QUALITY, IDENTITY_VIEW, loadBitmap, prepareImage, type PreparedImage, type View } from "./image.js";

export interface ImageEntry {
  id: number;
  name: string;
  bitmap: ImageBitmap;
  view: View;
  quality: number;
  prepared: PreparedImage | null;
}

/** Frame-pack limits for the animated upload: fewer than 2 is a still, more than 5 is a lot of flash. */
export const ANIMATED_MIN = 2;
export const ANIMATED_MAX = 5;

export class ImageStore extends EventTarget {
  entries: ImageEntry[] = [];
  selected: ImageEntry | null = null;
  private nextId = 1;

  on(type: "change", fn: (e: CustomEvent<ImageEntry[]>) => void): void;
  on(type: "select", fn: (e: CustomEvent<ImageEntry | null>) => void): void;
  on(type: "update", fn: (e: CustomEvent<ImageEntry>) => void): void;
  on(type: string, fn: (e: never) => void): void {
    this.addEventListener(type, fn as EventListener);
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Decode, append, select, and produce a first encode at the given output size. */
  async add(file: File, width: number, height: number): Promise<ImageEntry> {
    const entry: ImageEntry = {
      id: this.nextId++,
      name: file.name,
      bitmap: await loadBitmap(file),
      view: { ...IDENTITY_VIEW },
      quality: DEFAULT_QUALITY,
      prepared: null,
    };
    this.entries.push(entry);
    this.emit("change", this.entries);
    this.select(entry);
    await this.encode(entry, width, height);
    return entry;
  }

  remove(entry: ImageEntry): void {
    const i = this.entries.indexOf(entry);
    if (i < 0) return;
    this.entries.splice(i, 1);
    if (entry.prepared) URL.revokeObjectURL(entry.prepared.previewUrl);
    entry.bitmap.close();
    this.emit("change", this.entries);
    if (this.selected === entry) this.select(this.entries[Math.min(i, this.entries.length - 1)] ?? null);
  }

  select(entry: ImageEntry | null): void {
    if (this.selected === entry) return;
    this.selected = entry;
    this.emit("select", entry);
  }

  /** Re-encode `entry` from its current view/quality; the previous preview URL is released. */
  async encode(entry: ImageEntry, width: number, height: number): Promise<PreparedImage> {
    const prepared = await prepareImage(entry.bitmap, width, height, entry.quality, entry.view);
    if (entry.prepared) URL.revokeObjectURL(entry.prepared.previewUrl);
    entry.prepared = prepared;
    this.emit("update", entry);
    return prepared;
  }

  /** Entries that have an encode ready, in list order. */
  get ready(): ImageEntry[] {
    return this.entries.filter((e) => e.prepared);
  }
}
