/**
 * <image-picker> — file picker / drop zone, pan+zoom crop, quality slider, size readout.
 *
 * The round preview is a live canvas at the badge's native size. The user frames the
 * shot directly on it: drag to pan, wheel / pinch / slider to zoom, double-click to
 * reset. Every gesture redraws the canvas synchronously from the lossless source (cheap
 * at 368 px) and re-encodes the JPEG on a short debounce. Once the encode lands, the
 * *encoded* JPEG is decoded and painted back over the preview, so at rest you are looking
 * at the exact bytes the badge will receive — drag the quality slider and watch the
 * artefacts appear. "image" (detail: PreparedImage) is emitted at the same moment.
 *
 * Why no crop library: the output is a fixed square viewport, so "crop" here is only pan
 * and zoom with a cover clamp (image.ts::clampView). A crop-box UI would fight the round
 * preview and add ~40 KB for nothing we use.
 *
 * The `size` attribute ("368,368") comes from the badge's info report; until a badge is
 * connected we assume the DZBJ-TV07 default.
 */

import {
  DEFAULT_QUALITY,
  IDENTITY_VIEW,
  MAX_ZOOM,
  clampView,
  drawView,
  formatBytes,
  loadBitmap,
  neededKb,
  prepareImage,
  type PreparedImage,
  type View,
} from "../image.js";

const ENCODE_DEBOUNCE_MS = 120;

export class ImagePicker extends HTMLElement {
  static observedAttributes = ["size"];
  private bitmap: ImageBitmap | null = null;
  private prepared: PreparedImage | null = null;
  private quality = DEFAULT_QUALITY;
  private view: View = { ...IDENTITY_VIEW };
  private encodeTimer = 0;
  private encodeSerial = 0; // discard results of encodes that were superseded mid-flight
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; zoom: number } | null = null;

  private input!: HTMLInputElement;
  private drop!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private slider!: HTMLInputElement;
  private zoomSlider!: HTMLInputElement;
  private readout!: HTMLElement;

  get image(): PreparedImage | null {
    return this.prepared;
  }

  get size(): { width: number; height: number } {
    const [w, h] = (this.getAttribute("size") ?? "368,368").split(",").map(Number);
    return { width: w || 368, height: h || 368 };
  }

  connectedCallback(): void {
    this.innerHTML = `
      <div class="drop" tabindex="0" title="drag to pan, wheel or pinch to zoom, double-click to reset">
        <input type="file" accept="image/*" hidden>
        <canvas class="preview" hidden></canvas>
        <span class="hint">drop an image here or click to choose</span>
      </div>
      <div class="controls">
        <label>zoom <input type="range" class="zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" disabled></label>
        <button type="button" class="reset" disabled>reset</button>
        <button type="button" class="choose">choose file…</button>
      </div>
      <div class="controls">
        <label>quality <input type="range" class="quality" min="0.1" max="1" step="0.05" value="${DEFAULT_QUALITY}"> <output></output></label>
      </div>
      <div class="controls readout-row">
        <span class="readout" aria-live="polite"></span>
        <span class="encoded-tag" hidden>showing encoded JPEG</span>
      </div>`;
    this.input = this.querySelector("input[type=file]")!;
    this.drop = this.querySelector(".drop")!;
    this.canvas = this.querySelector("canvas")!;
    this.slider = this.querySelector(".quality")!;
    this.zoomSlider = this.querySelector(".zoom")!;
    this.readout = this.querySelector(".readout")!;

    // --- choosing a file: click (only while empty, so clicks don't fight panning), drop, paste
    this.querySelector(".choose")!.addEventListener("click", () => this.input.click());
    this.drop.addEventListener("click", () => {
      if (!this.bitmap) this.input.click();
    });
    this.input.addEventListener("change", () => void this.setFile(this.input.files?.[0]));
    this.drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.drop.classList.add("over");
    });
    this.drop.addEventListener("dragleave", () => this.drop.classList.remove("over"));
    this.drop.addEventListener("drop", (e) => {
      e.preventDefault();
      this.drop.classList.remove("over");
      void this.setFile(e.dataTransfer?.files[0]);
    });
    document.addEventListener("paste", (e) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) void this.setFile(f);
    });

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
      this.quality = Number(this.slider.value);
      this.querySelector("output")!.textContent = this.quality.toFixed(2);
      this.scheduleEncode();
    });
    this.querySelector("output")!.textContent = this.quality.toFixed(2);
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    // Fires for attributes present in the HTML *before* connectedCallback has built the
    // markup; nothing to update yet in that case. Only a real change of the badge's size
    // warrants a re-clamp + re-encode — anything else re-encoding here made the preview
    // churn every time some unrelated state was poked.
    if (!this.readout || oldValue === newValue) return;
    if (this.bitmap) this.setView(this.view);
  }

  // ------------------------------------------------------------------ file → bitmap

  private async setFile(file: File | undefined): Promise<void> {
    if (!file) return;
    this.bitmap = await loadBitmap(file);
    this.canvas.hidden = false;
    this.querySelector<HTMLElement>(".hint")!.hidden = true;
    this.zoomSlider.disabled = false;
    this.querySelector<HTMLButtonElement>(".reset")!.disabled = false;
    this.drop.classList.add("loaded");
    this.setView(IDENTITY_VIEW);
  }

  // ------------------------------------------------------------------ view handling

  /** Clamp, redraw immediately, schedule the JPEG encode. Single entry point for all gestures. */
  private setView(view: View): void {
    if (!this.bitmap) return;
    const { width, height } = this.size;
    this.view = clampView(view, this.bitmap, width, height);
    this.zoomSlider.value = String(this.view.zoom);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    drawView(this.canvas.getContext("2d")!, this.bitmap, width, height, this.view);
    this.querySelector<HTMLElement>(".encoded-tag")!.hidden = true; // live source until the encode lands
    this.scheduleEncode();
  }

  /** Zoom keeping the output point (px, py) — default centre — fixed under the cursor. */
  private zoomTo(zoom: number, px?: number, py?: number): void {
    const { width, height } = this.size;
    const cx = (px ?? width / 2) - width / 2;
    const cy = (py ?? height / 2) - height / 2;
    const ratio = Math.min(MAX_ZOOM, Math.max(1, zoom)) / this.view.zoom;
    // The point under the cursor is at (c - d) in image-centred coords; scaling about the
    // centre moves it to ratio*(c - d); shift d so it lands back on c.
    this.setView({
      zoom: this.view.zoom * ratio,
      dx: cx - ratio * (cx - this.view.dx),
      dy: cy - ratio * (cy - this.view.dy),
    });
  }

  /** Pointer position in output-canvas pixels (the canvas is CSS-scaled to fit). */
  private canvasPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const { width, height } = this.size;
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.bitmap) return;
    this.drop.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.canvasPoint(e));
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.view.zoom };
    }
    this.drop.classList.add("grabbing");
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.bitmap) return;
    const cur = this.canvasPoint(e);
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.zoomTo(this.pinchStart.zoom * (dist / this.pinchStart.dist), (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    } else if (this.pointers.size === 1) {
      this.setView({ ...this.view, dx: this.view.dx + (cur.x - prev.x), dy: this.view.dy + (cur.y - prev.y) });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.drop.classList.remove("grabbing");
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.bitmap) return;
    e.preventDefault();
    const p = this.canvasPoint(e);
    // ~10% per notch; trackpads deliver many small deltas, which this handles smoothly.
    this.zoomTo(this.view.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };

  // ------------------------------------------------------------------ encode + readout

  private scheduleEncode(): void {
    clearTimeout(this.encodeTimer);
    this.encodeTimer = window.setTimeout(() => void this.encode(), ENCODE_DEBOUNCE_MS);
  }

  private async encode(): Promise<void> {
    if (!this.bitmap) return;
    const serial = ++this.encodeSerial;
    const { width, height } = this.size;
    const prepared = await prepareImage(this.bitmap, width, height, this.quality, this.view);
    // Decode what we just encoded and show *that*; if a newer gesture/encode started while
    // we were busy, throw this one away so the preview never flashes a stale frame.
    const decoded = await createImageBitmap(new Blob([new Uint8Array(prepared.jpeg)], { type: "image/jpeg" }));
    if (serial !== this.encodeSerial) {
      decoded.close();
      URL.revokeObjectURL(prepared.previewUrl);
      return;
    }
    if (this.prepared) URL.revokeObjectURL(this.prepared.previewUrl);
    this.prepared = prepared;
    this.canvas.getContext("2d")!.drawImage(decoded, 0, 0);
    decoded.close();
    this.querySelector<HTMLElement>(".encoded-tag")!.hidden = false;
    this.updateReadout();
    this.dispatchEvent(new CustomEvent("image", { detail: this.prepared, bubbles: true }));
  }

  /** Encoded size only; whether it fits the badge is the connection panel's business. */
  private updateReadout(): void {
    this.readout.textContent = this.prepared
      ? `${formatBytes(this.prepared.jpeg.length)} JPEG, ${neededKb(this.prepared.jpeg.length)} KB on the badge`
      : "";
  }
}

customElements.define("image-picker", ImagePicker);
