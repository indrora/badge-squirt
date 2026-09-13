/**
 * <upload-progress> — the workbench's action bar: two send verbs, frame time, abort,
 * free-space override, and progress. Always visible; sticky when the layout collapses.
 *
 *   Send stills / items — every queued entry in list order on one connection, 2 s apart
 *     so the badge can write flash and render (verified pattern from dzbj.py `add a b c`).
 *     A still goes as ALBUM (type 6); a GIF goes as its own animation, DYNAMIC_ATMOSPHERE
 *     (type 5) at the file's native frame time. A GIF is a "funny shaped image" right up
 *     until the packet layer.
 *   Send animation — 2–5 entries flattened into one frame-pack (every GIF contributes all
 *     its frames, stills contribute one) and sent once as type 5 at the chosen frame time.
 *     Verified with `dzbj.py slideshow`.
 *
 * The badge never acks (doc §4), so "done" means the last packet left the radio and the
 * badge should now be showing "Updating…". Buttons carry their eligibility in their labels
 * and their `title` names the reason when disabled. The free-space check mirrors the
 * vendor app (ceil(bytes/1024) ≤ freespace) and can be overridden for firmware that lies.
 */

import type { Badge } from "../ble/badge.js";
import { formatBytes, neededKb } from "../image.js";
import { ANIMATED_MAX, ANIMATED_MIN, isAnimated, nativeIntervalMs, type ImageEntry, type ImageStore } from "../model.js";
import { framePack } from "../protocol/packet.js";

const PAUSE_BETWEEN_ITEMS_MS = 2000;
const DEFAULT_FRAME_S = 1;

export class UploadProgress extends HTMLElement {
  private badge: Badge | null = null;
  private store: ImageStore | null = null;
  private busy = false;
  private stage = "";
  private sendEach!: HTMLButtonElement;
  private sendAnim!: HTMLButtonElement;
  private abort!: HTMLButtonElement;
  private bar!: HTMLProgressElement;
  private text!: HTMLElement;
  private override!: HTMLInputElement;
  private frameTime!: HTMLInputElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="actions">
        <button type="button" class="send-each" disabled>Send</button>
        <div class="anim-group">
          <button type="button" class="send-anim" data-variant="secondary" disabled>Send as animation</button>
          <label class="frame-time-label">frame time <output>${DEFAULT_FRAME_S.toFixed(1)} s</output>
            <input type="range" class="frame-time" min="0.5" max="10" step="0.5" value="${DEFAULT_FRAME_S}" aria-label="frame time in seconds"></label>
        </div>
        <button type="button" class="abort ghost" data-variant="danger" hidden>Abort</button>
        <label class="override"><input type="checkbox"> ignore free-space check</label>
      </div>
      <div class="progress-row">
        <progress max="1" value="0"></progress>
        <span class="text text-light" aria-live="polite">nothing sent yet</span>
      </div>`;
    this.sendEach = this.querySelector(".send-each")!;
    this.sendAnim = this.querySelector(".send-anim")!;
    this.abort = this.querySelector(".abort")!;
    this.bar = this.querySelector("progress")!;
    this.text = this.querySelector(".text")!;
    this.override = this.querySelector("input[type=checkbox]")!;
    this.frameTime = this.querySelector(".frame-time")!;
    this.sendEach.addEventListener("click", () => void this.runIndividually());
    this.sendAnim.addEventListener("click", () => void this.runAnimated());
    this.abort.addEventListener("click", () => this.badge?.abort());
    this.frameTime.addEventListener("input", () => {
      this.querySelector("output")!.textContent = `${Number(this.frameTime.value).toFixed(1)} s`;
    });
  }

  attach(badge: Badge, store: ImageStore): void {
    this.badge = badge;
    this.store = store;
    badge.on("progress", (e) => {
      const p = e.detail;
      this.bar.value = p.bytes / p.totalBytes;
      this.text.textContent = `${this.stage}${p.sent}/${p.total} packets · ${formatBytes(p.bytes)} of ${formatBytes(p.totalBytes)}`;
    });
    badge.on("disconnected", () => this.refresh());
    store.on("change", () => this.refresh());
    store.on("update", () => this.refresh());
  }

  refresh(): void {
    // Everything here counts the same set the gauge counts: encoded and not yet sent.
    const ready = this.store?.queued ?? [];
    const n = ready.length;
    const connected = !!this.badge?.connected;
    const online = connected && !this.busy;
    const gifs = ready.filter(isAnimated).length;
    const allSent = n === 0 && (this.store?.ready.length ?? 0) > 0;
    const stills = n - gifs;

    this.sendEach.disabled = !online || n === 0;
    this.sendEach.textContent =
      n === 0
        ? "Send"
        : `Send ${[stills && `${stills} still${stills > 1 ? "s" : ""}`, gifs && `${gifs} animation${gifs > 1 ? "s" : ""}`].filter(Boolean).join(" + ")}`;
    this.sendEach.title = !connected
      ? "connect a badge first"
      : allSent
        ? "everything in the queue is already on the badge; change a picture to send it again"
        : n === 0
          ? "add a picture first"
          : "each picture becomes its own image on the badge";

    const animOk = n >= ANIMATED_MIN && n <= ANIMATED_MAX;
    this.sendAnim.disabled = !online || !animOk;
    this.sendAnim.title = !connected
      ? "connect a badge first"
      : n < ANIMATED_MIN
        ? `needs at least ${ANIMATED_MIN} pictures`
        : n > ANIMATED_MAX
          ? `at most ${ANIMATED_MAX} pictures can be flattened into one animation`
          : "all pictures cycle as one animation at the frame time";
    this.sendAnim.textContent = animOk ? `Send ${n} as one animation` : "Send as animation";
  }

  /** Vendor-app free-space rule; returns false (and explains) when the badge can't take it. */
  private fits(bytes: number): boolean {
    const free = this.badge?.info?.freespace;
    const need = neededKb(bytes);
    if (typeof free === "number" && need > free && !this.override.checked) {
      this.text.textContent = `needs ${need} KB but the badge has ${free} KB free — remove a picture, lower quality, or tick the override`;
      return false;
    }
    return true;
  }

  private async run(label: string, entries: ImageEntry[], work: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.refresh();
    this.abort.hidden = false;
    this.bar.value = 0;
    const t0 = performance.now();
    try {
      await work();
      const s = ((performance.now() - t0) / 1000).toFixed(1);
      this.text.textContent = `${label} sent in ${s} s — the badge should be updating (it never confirms)`;
      this.store!.markSent(entries);
      this.dispatchEvent(new CustomEvent("uploaded", { detail: entries, bubbles: true }));
    } catch (e) {
      this.text.textContent = `failed: ${(e as Error).message}`;
    } finally {
      this.busy = false;
      this.stage = "";
      this.abort.hidden = true;
      this.refresh();
    }
  }

  /** One entry as the badge should store it: a still, or a GIF as a native-speed animation. */
  private async sendEntry(entry: ImageEntry): Promise<void> {
    const p = entry.prepared!;
    if (isAnimated(entry)) {
      await this.badge!.uploadSlideshow(framePack(p.frames, p.width, p.height, nativeIntervalMs(entry)));
    } else {
      await this.badge!.uploadStill(p.frames[0]!);
    }
  }

  private async runIndividually(): Promise<void> {
    if (!this.badge || !this.store) return;
    const entries = this.store.queued;
    if (!this.fits(entries.reduce((n, e) => n + e.prepared!.bytes, 0))) return;
    await this.run(`${entries.length} picture${entries.length > 1 ? "s" : ""}`, entries, async () => {
      for (let i = 0; i < entries.length; i++) {
        this.stage = entries.length > 1 ? `[${i + 1}/${entries.length} ${entries[i]!.name}] ` : "";
        await this.sendEntry(entries[i]!);
        if (i < entries.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_ITEMS_MS));
      }
    });
  }

  private async runAnimated(): Promise<void> {
    if (!this.badge || !this.store) return;
    const entries = this.store.queued;
    const { width, height } = this.badge.size;
    const intervalMs = Math.round(Number(this.frameTime.value) * 1000);
    const frames = entries.flatMap((e) => e.prepared!.frames);
    const blob = framePack(frames, width, height, intervalMs);
    if (!this.fits(blob.length)) return;
    await this.run(`${frames.length}-frame animation`, entries, () => this.badge!.uploadSlideshow(blob));
  }
}

customElements.define("upload-progress", UploadProgress);
