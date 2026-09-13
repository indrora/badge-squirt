/**
 * <image-picker> — the editor for the *selected* entry: pan+zoom crop, quality slider.
 *
 * The round preview is a live canvas at the badge's native size. The user frames the
 * shot directly on it: drag to pan, wheel / pinch / slider to zoom, double-click to
 * reset. Every gesture redraws the canvas synchronously from the lossless source (cheap
 * at 368 px) and re-encodes the JPEG on a short debounce through the store. Once the
 * encode lands, the *encoded* JPEG is decoded and painted back over the preview, so at
 * rest you are looking at the exact bytes the badge will receive — drag the quality
 * slider and watch the artefacts appear.
 *
 * Adding/removing pictures lives in <image-list>; this element only edits what the
 * store says is selected and writes view/quality back into that entry.
 *
 * Why no crop library: the output is a fixed square viewport, so "crop" here is only pan
 * and zoom with a cover clamp (image.ts::clampView). A crop-box UI would fight the round
 * preview and add ~40 KB for nothing we use.
 */

import { IDENTITY_VIEW, MAX_ZOOM, clampView, drawView, formatBytes, neededKb, type View } from "../image.js";
import type { ImageEntry, ImageStore } from "../model.js";

const ENCODE_DEBOUNCE_MS = 120;

export class ImagePicker extends HTMLElement {
  static observedAttributes = ["size"];
  private store: ImageStore | null = null;
  private entry: ImageEntry | null = null;
  private encodeTimer = 0;
  private encodeSerial = 0; // discard results of encodes that were superseded mid-flight
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; zoom: number } | null = null;

  private drop!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private slider!: HTMLInputElement;
  private zoomSlider!: HTMLInputElement;
  private readout!: HTMLElement;

  get size(): { width: number; height: number } {
    const [w, h] = (this.getAttribute("size") ?? "368,368").split(",").map(Number);
    return { width: w || 368, height: h || 368 };
  }

  connectedCallback(): void {
    this.innerHTML = `
      <div class="drop" tabindex="0" title="drag to pan, wheel or pinch to zoom, double-click to reset">
        <canvas class="preview" hidden></canvas>
        <span class="hint">add a picture to start</span>
      </div>
      <div class="hstack mt-4 controls">
        <label>zoom <input type="range" class="zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" disabled></label>
        <button type="button" class="reset outline" data-variant="secondary" disabled>reset</button>
      </div>
      <div class="hstack mt-2 controls">
        <label>quality <output></output> <input type="range" class="quality" min="0.1" max="1" step="0.05" value="0.7" disabled></label>
      </div>
      <div class="hstack mt-2 readout-row">
        <span class="readout text-light" aria-live="polite"></span>
        <span class="encoded-tag badge" data-variant="secondary" hidden>showing encoded JPEG</span>
        <span class="sent-tag badge" data-variant="secondary" hidden>on the badge (as far as we know)</span>
      </div>`;
    this.drop = this.querySelector(".drop")!;
    this.canvas = this.querySelector("canvas")!;
    this.slider = this.querySelector(".quality")!;
    this.zoomSlider = this.querySelector(".zoom")!;
    this.readout = this.querySelector(".readout")!;

    // --- framing: pan by drag, zoom by wheel / pinch / slider, reset by double-click
    this.drop.addEventListener("pointerdown", this.onPointerDown);
    this.drop.addEventListener("pointermove", this.onPointerMove);
    this.drop.addEventListener("pointerup", this.onPointerUp);
    this.drop.addEventListener("pointercancel", this.onPointerUp);
    this.drop.addEventListener("wheel", this.onWheel, { passive: false });
    this.drop.addEventListener("dblclick", () => this.setView(IDENTITY_VIEW));
    this.zoomSlider.addEventListener("input", () => this.zoomTo(Number(this.zoomSlider.value)));
    this.querySelector(".reset")!.addEventListener("click", () => this.setView(IDENTITY_VIEW));

    // --- quality
    this.slider.addEventListener("input", () => {
      if (!this.entry) return;
      this.entry.quality = Number(this.slider.value);
      this.querySelector("output")!.textContent = this.entry.quality.toFixed(2);
      this.scheduleEncode();
    });
  }

  attach(store: ImageStore): void {
    this.store = store;
    store.on("select", (e) => this.show(e.detail));
    store.on("update", (e) => {
      if (e.detail === this.entry) this.querySelector<HTMLElement>(".sent-tag")!.hidden = !e.detail.sent;
    });
    // The store encodes a freshly added entry itself; when that lands for the entry we
    // are showing, paint it. Scheduling our own encode here as well used to double the
    // work for every GIF and revoke the preview URL the list thumbnail was using.
    store.on("update", (e) => {
      if (e.detail === this.entry && !this.encodeTimer) void this.paintEncoded(e.detail, this.encodeSerial);
    });
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    // Fires for attributes present in the HTML *before* connectedCallback has built the
    // markup; nothing to update yet in that case. Only a real change of the badge's size
    // warrants a re-clamp + re-encode — anything else re-encoding here made the preview
    // churn every time some unrelated state was poked.
    if (!this.readout || oldValue === newValue) return;
    if (this.entry) this.setView(this.entry.view);
  }

  // ------------------------------------------------------------------ entry selection

  private show(entry: ImageEntry | null): void {
    clearTimeout(this.encodeTimer);
    this.encodeSerial++; // orphan any in-flight encode for the previous entry
    this.entry = entry;
    const has = !!entry;
    this.canvas.hidden = !has;
    this.querySelector<HTMLElement>(".hint")!.hidden = has;
    this.zoomSlider.disabled = this.slider.disabled = !has;
    this.querySelector<HTMLButtonElement>(".reset")!.disabled = !has;
    this.drop.classList.toggle("loaded", has);
    this.querySelector<HTMLElement>(".encoded-tag")!.hidden = true;
    this.querySelector<HTMLElement>(".sent-tag")!.hidden = !entry?.sent;
    if (!entry) {
      this.readout.textContent = "";
      return;
    }
    this.slider.value = String(entry.quality);
    this.querySelector("output")!.textContent = entry.quality.toFixed(2);
    this.draw();
    if (!entry.prepared) return; // store.add is encoding; the "update" listener paints it
    // Already encoded: show it straight away, unless the badge's size changed meanwhile.
    if (entry.prepared.width === this.size.width && entry.prepared.height === this.size.height) {
      void this.paintEncoded(entry, this.encodeSerial);
    } else {
      this.scheduleEncode();
    }
  }

  // ------------------------------------------------------------------ view handling

  private draw(): void {
    if (!this.entry) return;
    const { width, height } = this.size;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // A GIF is edited through its first frame; the same view/quality applies to every frame.
    drawView(this.canvas.getContext("2d")!, this.entry.frames[0]!, width, height, this.entry.view);
    this.zoomSlider.value = String(this.entry.view.zoom);
  }

  /** Clamp, redraw immediately, schedule the JPEG encode. Single entry point for all gestures. */
  private setView(view: View): void {
    if (!this.entry) return;
    const { width, height } = this.size;
    this.entry.view = clampView(view, this.entry.frames[0]!, width, height);
    this.draw();
    this.querySelector<HTMLElement>(".encoded-tag")!.hidden = true; // live source until the encode lands
    this.scheduleEncode();
  }

  /** Zoom keeping the output point (px, py) — default centre — fixed under the cursor. */
  private zoomTo(zoom: number, px?: number, py?: number): void {
    if (!this.entry) return;
    const { width, height } = this.size;
    const v = this.entry.view;
    const cx = (px ?? width / 2) - width / 2;
    const cy = (py ?? height / 2) - height / 2;
    const ratio = Math.min(MAX_ZOOM, Math.max(1, zoom)) / v.zoom;
    // The point under the cursor is at (c - d) in image-centred coords; scaling about the
    // centre moves it to ratio*(c - d); shift d so it lands back on c.
    this.setView({ zoom: v.zoom * ratio, dx: cx - ratio * (cx - v.dx), dy: cy - ratio * (cy - v.dy) });
  }

  /** Pointer position in output-canvas pixels (the canvas is CSS-scaled to fit). */
  private canvasPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const { width, height } = this.size;
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.entry) return;
    this.drop.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.canvasPoint(e));
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.entry.view.zoom };
    }
    this.drop.classList.add("grabbing");
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.entry) return;
    const cur = this.canvasPoint(e);
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.zoomTo(this.pinchStart.zoom * (dist / this.pinchStart.dist), (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    } else if (this.pointers.size === 1) {
      const v = this.entry.view;
      this.setView({ ...v, dx: v.dx + (cur.x - prev.x), dy: v.dy + (cur.y - prev.y) });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.drop.classList.remove("grabbing");
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.entry) return;
    e.preventDefault();
    const p = this.canvasPoint(e);
    // ~10% per notch; trackpads deliver many small deltas, which this handles smoothly.
    this.zoomTo(this.entry.view.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };

  // ------------------------------------------------------------------ encode + readout

  private scheduleEncode(): void {
    clearTimeout(this.encodeTimer);
    this.encodeTimer = window.setTimeout(() => void this.encode(), ENCODE_DEBOUNCE_MS);
  }

  private async encode(): Promise<void> {
    this.encodeTimer = 0;
    if (!this.entry || !this.store) return;
    const entry = this.entry;
    const serial = ++this.encodeSerial;
    const { width, height } = this.size;
    await this.store.encode(entry, width, height);
    await this.paintEncoded(entry, serial);
  }

  /** Decode the entry's encoded JPEG and paint it; skipped if a newer encode/selection happened. */
  private async paintEncoded(entry: ImageEntry, serial: number): Promise<void> {
    if (!entry.prepared) return;
    const decoded = await createImageBitmap(new Blob([new Uint8Array(entry.prepared.frames[0]!)], { type: "image/jpeg" }));
    if (serial !== this.encodeSerial || entry !== this.entry) {
      decoded.close();
      return;
    }
    this.canvas.getContext("2d")!.drawImage(decoded, 0, 0);
    decoded.close();
    this.querySelector<HTMLElement>(".encoded-tag")!.hidden = false;
    const p = entry.prepared;
    this.readout.textContent =
      p.frames.length > 1
        ? `${p.frames.length} frames, ${formatBytes(p.bytes)} JPEG total, ${neededKb(p.bytes)} KB on the badge`
        : `${formatBytes(p.bytes)} JPEG, ${neededKb(p.bytes)} KB on the badge`;
  }
}

customElements.define("image-picker", ImagePicker);
