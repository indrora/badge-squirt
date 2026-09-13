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
 *   removed  — an entry was removed and can be undone for a while (detail: entry)
 *   purged   — the undo window closed; the entry's bitmaps are gone (detail: entry)
 */

import { DEFAULT_QUALITY, IDENTITY_VIEW, decodeFrames, prepareImage, type PreparedImage, type View } from "./image.js";

export interface ImageEntry {
  id: number;
  name: string;
  /** Source frames: one for a still, one per frame for a GIF. The editor shows frames[0]. */
  frames: ImageBitmap[];
  /** Display time per frame in ms as the file declared it (0 for a still). */
  durationsMs: number[];
  view: View;
  quality: number;
  prepared: PreparedImage | null;
  /** True once these exact bytes went to the badge; any re-encode clears it. Drives the gauge. */
  sent: boolean;
}

/** True when the entry came from an animated file. */
export const isAnimated = (e: ImageEntry): boolean => e.frames.length > 1;

/** The file's own frame time (median), for sending a GIF with its native timing. */
export function nativeIntervalMs(e: ImageEntry): number {
  const d = [...e.durationsMs].sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 100;
}

/**
 * Fewer than 2 frames is a still, not an animation. There is no upper bound: the vendor app's
 * five-picture cap was a UI choice with no protocol behind it (confirmed on hardware,
 * 2026-09-13); the only real limit is the badge's free space, which the gauge enforces.
 */
export const ANIMATED_MIN = 2;

export class ImageStore extends EventTarget {
  entries: ImageEntry[] = [];
  selected: ImageEntry | null = null;
  private nextId = 1;

  on(type: "change", fn: (e: CustomEvent<ImageEntry[]>) => void): void;
  on(type: "select", fn: (e: CustomEvent<ImageEntry | null>) => void): void;
  on(type: "update", fn: (e: CustomEvent<ImageEntry>) => void): void;
  on(type: "removed", fn: (e: CustomEvent<ImageEntry>) => void): void;
  on(type: "purged", fn: (e: CustomEvent<ImageEntry>) => void): void;
  on(type: string, fn: (e: never) => void): void {
    this.addEventListener(type, fn as EventListener);
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Decode, append, select, and produce a first encode at the given output size. */
  async add(file: File, width: number, height: number): Promise<ImageEntry> {
    const src = await decodeFrames(file);
    const entry: ImageEntry = {
      id: this.nextId++,
      name: file.name,
      frames: src.frames,
      durationsMs: src.durationsMs,
      view: { ...IDENTITY_VIEW },
      quality: DEFAULT_QUALITY,
      prepared: null,
      sent: false,
    };
    this.entries.push(entry);
    this.emit("change", this.entries);
    this.select(entry);
    await this.encode(entry, width, height);
    return entry;
  }

  /** The last removed entry, restorable until the next remove or until it is purged. */
  removed: { entry: ImageEntry; index: number } | null = null;
  private purgeTimer = 0;

  /**
   * Remove is one click or one keypress, so it is undoable: the entry is parked for a
   * while (bitmaps kept alive) and can be put back at its old index. A second remove
   * purges the first; so does the timeout. Nothing here touches the badge.
   */
  remove(entry: ImageEntry, undoWindowMs = 8000): void {
    const i = this.entries.indexOf(entry);
    if (i < 0) return;
    this.purgeRemoved();
    this.entries.splice(i, 1);
    this.removed = { entry, index: i };
    this.emit("change", this.entries);
    this.emit("removed", entry);
    if (this.selected === entry) this.select(this.entries[Math.min(i, this.entries.length - 1)] ?? null);
    this.purgeTimer = window.setTimeout(() => this.purgeRemoved(), undoWindowMs);
  }

  /** Put the last removed entry back where it was. Returns it, or null if nothing to undo. */
  undoRemove(): ImageEntry | null {
    if (!this.removed) return null;
    clearTimeout(this.purgeTimer);
    const { entry, index } = this.removed;
    this.removed = null;
    this.entries.splice(Math.min(index, this.entries.length), 0, entry);
    this.emit("change", this.entries);
    this.select(entry);
    return entry;
  }

  private purgeRemoved(): void {
    clearTimeout(this.purgeTimer);
    if (!this.removed) return;
    const { entry } = this.removed;
    this.removed = null;
    if (entry.prepared) URL.revokeObjectURL(entry.prepared.previewUrl);
    for (const f of entry.frames) f.close();
    this.emit("purged", entry);
  }

  select(entry: ImageEntry | null): void {
    if (this.selected === entry) return;
    this.selected = entry;
    this.emit("select", entry);
  }

  /** Re-encode `entry` from its current view/quality; the previous preview URL is released. */
  async encode(entry: ImageEntry, width: number, height: number): Promise<PreparedImage> {
    const prepared = await prepareImage(entry.frames, width, height, entry.quality, entry.view);
    if (entry.prepared) URL.revokeObjectURL(entry.prepared.previewUrl);
    entry.prepared = prepared;
    entry.sent = false;
    this.emit("update", entry);
    return prepared;
  }

  /** Called by the uploader after a successful send so the gauge moves bytes from queued to used. */
  markSent(entries: ImageEntry[]): void {
    for (const e of entries) {
      e.sent = true;
      this.emit("update", e);
    }
  }

  /** Encoded entries not yet on the badge, in list order. */
  get queued(): ImageEntry[] {
    return this.entries.filter((e) => e.prepared && !e.sent);
  }

  /** Entries that have an encode ready, in list order. */
  get ready(): ImageEntry[] {
    return this.entries.filter((e) => e.prepared);
  }
}
