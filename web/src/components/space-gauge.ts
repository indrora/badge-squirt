/**
 * <space-gauge> — the badge's flash as one bar: what is on it plus what is queued, against
 * what is free. This is the workbench's focal moment (doc/shape-workbench.md): adding a
 * picture visibly fills the bar, so "will it fit" is answered before anyone presses Send.
 *
 * Two colours by decision: what is on the badge NOW is a fact and gets a neutral ink fill;
 * what is QUEUED is the thing about to change and takes the accent (Oat --success), turning
 * --warning once the total passes 90% and --danger when it would not fit. The queued span
 * is hatched as well as coloured so colour is never the only code, and it is never drawn
 * under 6 px when non-zero: at real capacities (16 MB badge, 25 KB pictures) a true-scale
 * sliver would be invisible, and the whole point of this bar is to see the queue land.
 * A native <meter> can paint only one fill, so this is a role="meter" div with two spans.
 * Before a badge is connected there is nothing to measure; the bar sits empty and says so.
 *
 * Numbers: the badge reports allspace/freespace in KB once per connection and never again.
 * "used" is allspace − freespace as reported; after an upload main.ts lowers freespace by
 * the sent entries' KB and the store marks them sent, so they move from queued to used
 * instead of being counted twice.
 */

import type { Badge } from "../ble/badge.js";
import { neededKb } from "../image.js";
import type { ImageStore } from "../model.js";

export class SpaceGauge extends HTMLElement {
  private badge: Badge | null = null;
  private store: ImageStore | null = null;
  private track!: HTMLElement;
  private used!: HTMLElement;
  private queuedSeg!: HTMLElement;
  private caption!: HTMLElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="gauge-head">
        <h2>Badge storage</h2>
        <span class="caption text-light" aria-live="polite">connect to see space</span>
      </div>
      <div class="track" role="meter" aria-label="badge storage" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" aria-hidden="true">
        <span class="seg used"></span><span class="seg queued"></span>
      </div>
      <p class="legend text-light"><span class="key used"></span> on the badge <span class="key queued"></span> queued</p>
      <label class="override" data-variant="danger">
        <input type="checkbox"> send even if it will not fit
        <span class="text-light">the badge may refuse or truncate; use when the report above is wrong</span>
      </label>`;
    this.track = this.querySelector(".track")!;
    this.used = this.querySelector(".seg.used")!;
    this.queuedSeg = this.querySelector(".seg.queued")!;
    this.caption = this.querySelector(".caption")!;
    // The override lives with the number it overrides. Whoever sends listens for this.
    this.querySelector<HTMLInputElement>(".override input")!.addEventListener("change", (e) => {
      this.dispatchEvent(new CustomEvent("override-change", { detail: (e.target as HTMLInputElement).checked, bubbles: true }));
    });
  }

  get override(): boolean {
    return this.querySelector<HTMLInputElement>(".override input")?.checked ?? false;
  }

  attach(badge: Badge, store: ImageStore): void {
    this.badge = badge;
    this.store = store;
    badge.on("info", () => this.render());
    badge.on("disconnected", () => this.render());
    store.on("change", () => this.render());
    store.on("update", () => this.render());
  }

  /** KB the un-sent queue would take on the badge. */
  get queuedKb(): number {
    return this.store?.queued.reduce((n, e) => n + neededKb(e.prepared!.bytes), 0) ?? 0;
  }

  render(): void {
    const info = this.badge?.connected ? this.badge.info : null;
    const queued = this.queuedKb;
    if (!info) {
      this.used.style.width = "0%";
      this.queuedSeg.style.width = "0%";
      this.track.setAttribute("aria-hidden", "true"); // nothing to measure; the caption speaks instead
      this.querySelector<HTMLElement>(".override")!.hidden = true; // nothing to override until a badge reports
      this.caption.textContent = queued ? `${queued} KB queued · connect to see space` : "connect to see space";
      this.classList.remove("over", "tight");
      return;
    }
    const total = info.allspace ?? info.freespace + Math.max(0, queued);
    const used = total - info.freespace;
    const fill = used + queued;
    const over = fill > total;
    // Percent widths on the track; the queued span keeps a CSS min-width when non-zero so a
    // 25 KB picture on a 16 MB badge still lands visibly. The used span yields the space.
    const usedPct = Math.min(100, (used / total) * 100);
    const queuedPct = Math.min(100 - usedPct, (queued / total) * 100);
    this.used.style.width = `${usedPct}%`;
    this.queuedSeg.style.width = `${queuedPct}%`;
    this.queuedSeg.classList.toggle("some", queued > 0);
    this.track.removeAttribute("aria-hidden");
    this.track.setAttribute("aria-valuemax", String(total));
    this.track.setAttribute("aria-valuenow", String(Math.min(fill, total)));
    this.track.setAttribute("aria-valuetext", `${used} KB on the badge, ${queued} KB queued, ${Math.max(0, total - fill)} KB free`);
    this.querySelector<HTMLElement>(".override")!.hidden = false;
    this.classList.toggle("over", over);
    this.classList.toggle("tight", !over && fill > total * 0.9);
    this.caption.textContent = over
      ? `${used} KB on the badge · ${queued} KB queued · over by ${fill - total} KB`
      : `${used} KB on the badge · ${queued} KB queued · ${total - fill} KB free`;
  }
}

customElements.define("space-gauge", SpaceGauge);
