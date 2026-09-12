/**
 * <upload-progress> — two ways to ship the stack, plus progress, abort and override.
 *
 *   individually — every picture in list order as its own ALBUM (type 6) still, on one
 *                  connection with a 2 s pause between so the badge can write flash and
 *                  render (verified pattern from py_tool/dzbj.py `add a b c`).
 *   animated     — 2–5 pictures packed into the 0x12345678 frame-pack container and sent
 *                  once as DYNAMIC_ATMOSPHERE (type 5); the badge cycles them at the
 *                  chosen frame time. Verified with `dzbj.py slideshow`.
 *
 * The badge never acks (doc §4), so "done" means the last packet left the radio and the
 * badge should now be showing "Updating…". The free-space check mirrors the vendor app
 * (ceil(bytes/1024) ≤ freespace) and can be overridden for firmware that lies.
 */

import type { Badge } from "../ble/badge.js";
import { formatBytes, neededKb } from "../image.js";
import { ANIMATED_MAX, ANIMATED_MIN, type ImageStore } from "../model.js";
import { framePack } from "../protocol/packet.js";

const PAUSE_BETWEEN_STILLS_MS = 2000;
const DEFAULT_FRAME_S = 1;

export class UploadProgress extends HTMLElement {
  private badge: Badge | null = null;
  private store: ImageStore | null = null;
  private busy = false;
  private sendEach!: HTMLButtonElement;
  private sendAnim!: HTMLButtonElement;
  private abort!: HTMLButtonElement;
  private bar!: HTMLProgressElement;
  private text!: HTMLElement;
  private override!: HTMLInputElement;
  private frameTime!: HTMLInputElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="panels">
        <div class="panel">
          <h3>Upload individually</h3>
          <p class="hint each-hint">each picture becomes its own still; the badge keeps them all</p>
          <button type="button" class="primary send-each" disabled>Send stills</button>
        </div>
        <div class="panel">
          <h3>Upload animated</h3>
          <p class="hint anim-hint">${ANIMATED_MIN}–${ANIMATED_MAX} pictures cycle as one animation</p>
          <label>frame time <input type="range" class="frame-time" min="0.5" max="10" step="0.5" value="${DEFAULT_FRAME_S}"> <output>${DEFAULT_FRAME_S.toFixed(1)} s</output></label>
          <button type="button" class="primary send-anim" disabled>Send animation</button>
        </div>
      </div>
      <div class="row">
        <button type="button" class="abort" hidden>Abort</button>
        <label class="override"><input type="checkbox"> ignore free-space check</label>
      </div>
      <progress max="1" value="0"></progress>
      <span class="text" aria-live="polite"></span>`;
    this.sendEach = this.querySelector(".send-each")!;
    this.sendAnim = this.querySelector(".send-anim")!;
    this.abort = this.querySelector(".abort")!;
    this.bar = this.querySelector("progress")!;
    this.text = this.querySelector(".text")!;
    this.override = this.querySelector("input[type=checkbox]")!;
    this.frameTime = this.querySelector(".frame-time")!;
    this.sendEach.addEventListener("click", () => void this.runStills());
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

  private stage = "";

  refresh(): void {
    const n = this.store?.ready.length ?? 0;
    const online = !!this.badge?.connected && !this.busy;
    this.sendEach.disabled = !online || n === 0;
    this.sendEach.textContent = n > 1 ? `Send ${n} stills` : "Send still";
    const animOk = n >= ANIMATED_MIN && n <= ANIMATED_MAX;
    this.sendAnim.disabled = !online || !animOk;
    this.querySelector<HTMLElement>(".anim-hint")!.classList.toggle("bad", n > ANIMATED_MAX);
  }

  /** Vendor-app free-space rule; returns false (and explains) when the badge can't take it. */
  private fits(bytes: number): boolean {
    const free = this.badge?.info?.freespace;
    const need = neededKb(bytes);
    if (typeof free === "number" && need > free && !this.override.checked) {
      this.text.textContent = `needs ${need} KB but badge has ${free} KB free — tick the override to send anyway`;
      return false;
    }
    return true;
  }

  private async run(label: string, work: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.refresh();
    this.abort.hidden = false;
    this.bar.value = 0;
    const t0 = performance.now();
    try {
      await work();
      const s = ((performance.now() - t0) / 1000).toFixed(1);
      this.text.textContent = `${label} done in ${s} s — badge should be updating`;
      this.dispatchEvent(new CustomEvent("uploaded", { bubbles: true }));
    } catch (e) {
      this.text.textContent = `failed: ${(e as Error).message}`;
    } finally {
      this.busy = false;
      this.stage = "";
      this.abort.hidden = true;
      this.refresh();
    }
  }

  private async runStills(): Promise<void> {
    if (!this.badge || !this.store) return;
    const entries = this.store.ready;
    const total = entries.reduce((n, e) => n + e.prepared!.jpeg.length, 0);
    if (!this.fits(total)) return;
    await this.run(`${entries.length} still(s)`, async () => {
      for (let i = 0; i < entries.length; i++) {
        this.stage = entries.length > 1 ? `[${i + 1}/${entries.length} ${entries[i]!.name}] ` : "";
        await this.badge!.uploadStill(entries[i]!.prepared!.jpeg);
        if (i < entries.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_STILLS_MS));
      }
    });
  }

  private async runAnimated(): Promise<void> {
    if (!this.badge || !this.store) return;
    const entries = this.store.ready;
    const { width, height } = this.badge.size;
    const intervalMs = Math.round(Number(this.frameTime.value) * 1000);
    const blob = framePack(entries.map((e) => e.prepared!.jpeg), width, height, intervalMs);
    if (!this.fits(blob.length)) return;
    await this.run(`${entries.length}-frame animation`, () => this.badge!.uploadSlideshow(blob));
  }
}

customElements.define("upload-progress", UploadProgress);
