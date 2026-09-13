/**
 * <image-list> — the queue in the hardware rail: add (file picker, multiple), select, remove.
 *
 * Each row shows the encoded thumbnail (so it reflects crop and quality), the file name
 * and the encoded size; an animated entry (GIF) also shows its frame count and native
 * frame time, and an entry that has already gone to the badge is marked "sent" until it
 * is re-encoded. Clicking a row selects it in the store; the editor follows the store's
 * "select" event. Drop and paste anywhere on the page also add pictures — that is wired
 * here because "add" is this component's job, wherever the gesture lands.
 *
 * Markup follows Oat (oat.ink): plain <button>s with data-variant, `.hstack`, `.badge`,
 * `ul.unstyled`; the remove control is an authored SVG, not a glyph.
 */

import { formatBytes } from "../image.js";
import { isAnimated, nativeIntervalMs, type ImageEntry, type ImageStore } from "../model.js";

const REMOVE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

export class ImageList extends HTMLElement {
  private store: ImageStore | null = null;
  private size = { width: 368, height: 368 };
  private list!: HTMLElement;
  private input!: HTMLInputElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="hstack justify-between">
        <h2 class="rail-title">Queue</h2>
        <button type="button" class="add" data-variant="secondary">Add pictures…</button>
        <input type="file" accept="image/*" multiple hidden>
      </div>
      <p class="text-light hint">Drop or paste pictures anywhere. A GIF stays animated.</p>
      <ul class="entries unstyled" role="listbox" aria-label="pictures to send"></ul>
      <p class="undo-line text-light" role="status" aria-live="polite" hidden>
        <span class="undo-text"></span> <button type="button" class="undo ghost">Undo</button>
      </p>`;
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
    this.querySelector(".undo")!.addEventListener("click", () => {
      this.store?.undoRemove();
      this.querySelector<HTMLElement>(".undo-line")!.hidden = true;
    });
  }

  attach(store: ImageStore): void {
    this.store = store;
    store.on("change", () => this.render());
    store.on("select", () => this.render());
    store.on("update", (e) => this.renderRow(e.detail));
    // Removal is one click; say what went and offer the way back until the store purges it.
    store.on("removed", (e) => {
      const line = this.querySelector<HTMLElement>(".undo-line")!;
      line.hidden = false;
      // Un-hide first, populate next tick: a live region that appears already filled is
      // skipped by some screen readers, one that changes while visible is announced.
      setTimeout(() => (this.querySelector<HTMLElement>(".undo-text")!.textContent = `removed ${e.detail.name}`), 0);
    });
    store.on("purged", () => (this.querySelector<HTMLElement>(".undo-line")!.hidden = true));
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
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(entry === this.store!.selected));
    li.classList.toggle("selected", entry === this.store!.selected);
    li.innerHTML = `
      <img class="thumb" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <span class="name"></span>
      <span class="meta text-light"></span>
      <button type="button" class="remove ghost" aria-label="remove ${entry.name}">${REMOVE_ICON}</button>`;
    li.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".remove")) this.store!.remove(entry);
      else this.store!.select(entry);
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.store!.select(entry);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.store!.remove(entry);
      }
    });
    this.fill(li, entry);
    return li;
  }

  private renderRow(entry: ImageEntry): void {
    const li = this.list.querySelector<HTMLLIElement>(`li[data-id="${entry.id}"]`);
    if (li) this.fill(li, entry);
  }

  private fill(li: HTMLLIElement, entry: ImageEntry): void {
    const name = li.querySelector<HTMLElement>(".name")!;
    name.textContent = entry.name;
    name.title = entry.name;
    const img = li.querySelector<HTMLImageElement>(".thumb")!;
    const meta = li.querySelector<HTMLElement>(".meta")!;
    // Tags ride the meta line, not the name: the name is one clipped line and would
    // swallow them; the meta line wraps.
    meta.replaceChildren();
    if (entry.prepared) {
      img.src = entry.prepared.previewUrl;
      meta.append(`${formatBytes(entry.prepared.bytes)} · quality ${entry.quality.toFixed(2)}`);
    } else {
      meta.append("encoding…");
    }
    if (isAnimated(entry)) meta.append(" ", badge(`${entry.frames.length} frames, ${nativeIntervalMs(entry)} ms each`, "secondary"));
    if (entry.sent) meta.append(" ", badge("sent", "secondary"));
  }
}

function badge(text: string, variant: string): HTMLSpanElement {
  const tag = document.createElement("span");
  tag.className = "badge";
  tag.dataset["variant"] = variant;
  tag.textContent = text;
  return tag;
}

customElements.define("image-list", ImageList);
