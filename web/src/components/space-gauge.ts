/**
 * <space-gauge> — the badge's flash as one bar: what is on it plus what is queued, against
 * what is free. This is the workbench's focal moment (doc/shape-workbench.md): adding a
 * picture visibly fills the bar, so "will it fit" is answered before anyone presses Send.
 *
 * Two segments by decision: used+queued as one fill, free as the remainder. Colour comes
 * from Oat's <meter> bands: healthy fill is the success colour, past 90% it turns warning,
 * and when the queue would overflow the badge the meter pins at max and goes danger while
 * the caption says by how much. The HTML meter derives those bands from where `optimum`
 * sits relative to `low`/`high`, hence the two placements below. Before a badge is
 * connected there is nothing to measure; the bar sits empty and says so.
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
  private meter!: HTMLMeterElement;
  private caption!: HTMLElement;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="gauge-head">
        <h2>Badge storage</h2>
        <span class="caption text-light" aria-live="polite">connect to see space</span>
      </div>
      <meter min="0" max="1" value="0" aria-label="badge storage used, including queued pictures" aria-hidden="true"></meter>
      <label class="override" data-variant="danger">
        <input type="checkbox"> send even if it will not fit
        <span class="text-light">the badge may refuse or truncate; use when the report above is wrong</span>
      </label>`;
    this.meter = this.querySelector("meter")!;
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
      this.meter.max = 1;
      this.meter.value = 0;
      this.meter.removeAttribute("high");
      this.meter.setAttribute("aria-hidden", "true"); // "0 of 1" would be a lie; the caption speaks instead
      this.querySelector<HTMLElement>(".override")!.hidden = true; // nothing to override until a badge reports
      this.caption.textContent = queued ? `${queued} KB queued · connect to see space` : "connect to see space";
      this.classList.remove("over");
      return;
    }
    const total = info.allspace ?? info.freespace + Math.max(0, queued);
    const used = total - info.freespace;
    const fill = used + queued;
    const over = fill > total;
    this.meter.max = total;
    this.meter.low = 1;
    this.meter.high = total * 0.9;
    // optimum in the middle band → middle = green, above `high` = warning (suboptimum);
    // optimum below `low` → above `high` becomes "even less good" = danger, used for overflow.
    this.meter.optimum = over ? 0 : total / 2;
    this.meter.value = Math.min(fill, total);
    this.meter.removeAttribute("aria-hidden");
    this.querySelector<HTMLElement>(".override")!.hidden = false;
    this.classList.toggle("over", over);
    this.caption.textContent = over
      ? `${used} KB used · ${queued} KB queued · over by ${fill - total} KB`
      : `${used} KB used · ${queued} KB queued · ${total - fill} KB free`;
  }
}

customElements.define("space-gauge", SpaceGauge);
