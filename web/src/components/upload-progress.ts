/**
 * <upload-progress> — send button, progress bar, abort, and a free-space override.
 *
 * The badge never acks (see doc §4), so "done" means the last packet left the radio and
 * the badge should now be showing "Updating…". The free-space check mirrors the vendor
 * app (ceil(bytes/1024) ≤ freespace) and can be overridden for firmware that lies.
 */

import type { Badge } from "../ble/badge.js";
import { formatBytes, neededKb, type PreparedImage } from "../image.js";

export class UploadProgress extends HTMLElement {
  private badge: Badge | null = null;
  private image: PreparedImage | null = null;
  private busy = false;
  private send!: HTMLButtonElement;
  private abort!: HTMLButtonElement;
  private bar!: HTMLProgressElement;
  private text!: HTMLElement;
  private override!: HTMLInputElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="row">
        <button type="button" class="primary send" disabled>Send to badge</button>
        <button type="button" class="abort" hidden>Abort</button>
        <label class="override"><input type="checkbox"> ignore free-space check</label>
      </div>
      <progress max="1" value="0"></progress>
      <span class="text" aria-live="polite"></span>`;
    this.send = this.querySelector(".send")!;
    this.abort = this.querySelector(".abort")!;
    this.bar = this.querySelector("progress")!;
    this.text = this.querySelector(".text")!;
    this.override = this.querySelector("input[type=checkbox]")!;
    this.send.addEventListener("click", () => void this.run());
    this.abort.addEventListener("click", () => this.badge?.abort());
  }

  attach(badge: Badge): void {
    this.badge = badge;
    badge.on("progress", (e) => {
      const p = e.detail;
      this.bar.value = p.bytes / p.totalBytes;
      this.text.textContent = `${p.sent}/${p.total} packets · ${formatBytes(p.bytes)} of ${formatBytes(p.totalBytes)}`;
    });
    badge.on("disconnected", () => this.refresh());
  }

  setImage(image: PreparedImage | null): void {
    this.image = image;
    this.refresh();
  }

  refresh(): void {
    this.send.disabled = this.busy || !this.image || !this.badge?.connected;
  }

  private async run(): Promise<void> {
    if (!this.badge || !this.image) return;
    const free = this.badge.info?.freespace;
    const need = neededKb(this.image.jpeg.length);
    if (typeof free === "number" && need > free && !this.override.checked) {
      this.text.textContent = `needs ${need} KB but badge has ${free} KB free — tick the override to send anyway`;
      return;
    }
    this.busy = true;
    this.refresh();
    this.abort.hidden = false;
    this.bar.value = 0;
    const t0 = performance.now();
    try {
      await this.badge.uploadStill(this.image.jpeg);
      const s = ((performance.now() - t0) / 1000).toFixed(1);
      this.text.textContent = `done in ${s} s — badge should be updating`;
      this.dispatchEvent(new CustomEvent("uploaded", { bubbles: true }));
    } catch (e) {
      this.text.textContent = `failed: ${(e as Error).message}`;
    } finally {
      this.busy = false;
      this.abort.hidden = true;
      this.refresh();
    }
  }
}

customElements.define("upload-progress", UploadProgress);
