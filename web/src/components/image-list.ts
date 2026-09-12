/**
 * <image-list> — the stack of pictures: add (file picker, multiple), select, remove.
 *
 * Each row shows the encoded thumbnail (so it reflects crop and quality), the file name
 * and the encoded size. Clicking a row selects it in the store; the editor follows the
 * store's "select" event. Drop and paste anywhere on the page also add pictures — that
 * is wired here because "add" is this component's job, wherever the gesture lands.
 */

import { formatBytes } from "../image.js";
import type { ImageEntry, ImageStore } from "../model.js";

export class ImageList extends HTMLElement {
  private store: ImageStore | null = null;
  private size = { width: 368, height: 368 };
  private list!: HTMLElement;
  private input!: HTMLInputElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="row">
        <button type="button" class="primary add">Add pictures…</button>
        <input type="file" accept="image/*" multiple hidden>
        <span class="status hint">or drop / paste images anywhere</span>
      </div>
      <ul class="entries"></ul>`;
    this.list = this.querySelector("ul")!;
    this.input = this.querySelector("input")!;
    this.querySelector(".add")!.addEventListener("click", () => this.input.click());
    this.input.addEventListener("change", () => {
      void this.addFiles(this.input.files);
      this.input.value = "";
    });
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      void this.addFiles(e.dataTransfer?.files ?? null);
    });
    document.addEventListener("paste", (e) => void this.addFiles(e.clipboardData?.files ?? null));
  }

  attach(store: ImageStore): void {
    this.store = store;
    store.on("change", () => this.render());
    store.on("select", () => this.render());
    store.on("update", (e) => this.renderRow(e.detail));
  }

  /** Output size for the first encode; the editor re-encodes if the badge reports another. */
  setSize(width: number, height: number): void {
    this.size = { width, height };
  }

  private async addFiles(files: FileList | null): Promise<void> {
    if (!files || !this.store) return;
    for (const f of [...files]) {
      if (!f.type.startsWith("image/")) continue;
      await this.store.add(f, this.size.width, this.size.height);
    }
  }

  private render(): void {
    if (!this.store) return;
    this.list.replaceChildren(...this.store.entries.map((entry) => this.row(entry)));
    this.querySelector<HTMLElement>(".hint")!.hidden = this.store.entries.length > 0;
  }

  private row(entry: ImageEntry): HTMLLIElement {
    const li = document.createElement("li");
    li.dataset["id"] = String(entry.id);
    li.classList.toggle("selected", entry === this.store!.selected);
    li.innerHTML = `
      <img class="thumb" alt="">
      <span class="name"></span>
      <span class="meta"></span>
      <button type="button" class="remove" title="remove">✕</button>`;
    li.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".remove")) this.store!.remove(entry);
      else this.store!.select(entry);
    });
    this.fill(li, entry);
    return li;
  }

  private renderRow(entry: ImageEntry): void {
    const li = this.list.querySelector<HTMLLIElement>(`li[data-id="${entry.id}"]`);
    if (li) this.fill(li, entry);
  }

  private fill(li: HTMLLIElement, entry: ImageEntry): void {
    li.querySelector<HTMLElement>(".name")!.textContent = entry.name;
    const img = li.querySelector<HTMLImageElement>(".thumb")!;
    if (entry.prepared) {
      img.src = entry.prepared.previewUrl;
      li.querySelector<HTMLElement>(".meta")!.textContent =
        `${formatBytes(entry.prepared.jpeg.length)} · q${entry.quality.toFixed(2)}`;
    } else {
      li.querySelector<HTMLElement>(".meta")!.textContent = "encoding…";
    }
  }
}

customElements.define("image-list", ImageList);
