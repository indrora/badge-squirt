/**
 * <image-picker> — file picker / drop zone, quality slider, round preview, size readout.
 *
 * Emits "image" (detail: PreparedImage) whenever the source or the quality changes so
 * the uploader always holds exactly the bytes shown in the preview. Re-encoding on every
 * slider tick is cheap at 368 px. The `size` attribute ("368,368") comes from the badge's
 * info report; until a badge is connected we assume the DZBJ-TV07 default.
 */

import { DEFAULT_QUALITY, formatBytes, loadBitmap, neededKb, prepareImage, type PreparedImage } from "../image.js";

export class ImagePicker extends HTMLElement {
  static observedAttributes = ["size", "free"];
  private bitmap: ImageBitmap | null = null;
  private prepared: PreparedImage | null = null;
  private quality = DEFAULT_QUALITY;
  private input!: HTMLInputElement;
  private drop!: HTMLElement;
  private preview!: HTMLImageElement;
  private slider!: HTMLInputElement;
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
      <label class="drop" tabindex="0">
        <input type="file" accept="image/*" hidden>
        <img class="preview" alt="preview of what will be sent" hidden>
        <span class="hint">drop an image here or click to choose</span>
      </label>
      <div class="controls">
        <label>quality <input type="range" min="0.3" max="1" step="0.05" value="${DEFAULT_QUALITY}"> <output></output></label>
        <span class="readout" aria-live="polite"></span>
      </div>`;
    this.input = this.querySelector("input[type=file]")!;
    this.drop = this.querySelector(".drop")!;
    this.preview = this.querySelector(".preview")!;
    this.slider = this.querySelector("input[type=range]")!;
    this.readout = this.querySelector(".readout")!;

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
    // Paste works too — handy for screenshots.
    document.addEventListener("paste", (e) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) void this.setFile(f);
    });
    this.slider.addEventListener("input", () => {
      this.quality = Number(this.slider.value);
      this.querySelector("output")!.textContent = this.quality.toFixed(2);
      void this.reencode();
    });
    this.querySelector("output")!.textContent = this.quality.toFixed(2);
  }

  attributeChangedCallback(): void {
    // Fires for attributes present in the HTML *before* connectedCallback has built the
    // markup; nothing to update yet in that case.
    if (!this.readout) return;
    if (this.bitmap) void this.reencode();
    else this.updateReadout();
  }

  private async setFile(file: File | undefined): Promise<void> {
    if (!file) return;
    this.bitmap = await loadBitmap(file);
    await this.reencode();
  }

  private async reencode(): Promise<void> {
    if (!this.bitmap) return;
    const { width, height } = this.size;
    if (this.prepared) URL.revokeObjectURL(this.prepared.previewUrl);
    this.prepared = await prepareImage(this.bitmap, width, height, this.quality);
    this.preview.src = this.prepared.previewUrl;
    this.preview.hidden = false;
    this.querySelector<HTMLElement>(".hint")!.hidden = true;
    this.updateReadout();
    this.dispatchEvent(new CustomEvent("image", { detail: this.prepared, bubbles: true }));
  }

  private updateReadout(): void {
    if (!this.prepared) {
      this.readout.textContent = "";
      return;
    }
    const free = Number(this.getAttribute("free"));
    const need = neededKb(this.prepared.jpeg.length);
    const fits = !free || need <= free;
    this.readout.textContent = `${formatBytes(this.prepared.jpeg.length)} → ${need} KB${free ? ` of ${free} KB free` : ""}`;
    this.readout.classList.toggle("bad", !fits);
  }
}

customElements.define("image-picker", ImagePicker);
