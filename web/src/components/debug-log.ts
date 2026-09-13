/**
 * <debug-log> — every log line, every notify frame as raw hex, and the raw hex of the
 * first few outgoing packets. This pane is the whole reason disagreements with the vendor
 * app can be settled: compare bytes, not vibes.
 */

import type { Badge } from "../ble/badge.js";
import { toHex } from "../protocol/packet.js";

const SHOW_PACKETS = 3; // raw hex of this many leading packets per upload
const MAX_LINES = 500;

export class DebugLog extends HTMLElement {
  private pre!: HTMLPreElement;
  private lines = 0;

  connectedCallback(): void {
    this.innerHTML = `
      <div class="hstack">
        <button type="button" class="clear outline" data-variant="secondary">clear</button>
        <label><input type="checkbox" class="acks" checked> hide per-packet acks</label>
      </div>
      <pre class="log mt-4" tabindex="0"></pre>`;
    this.pre = this.querySelector("pre")!;
    this.querySelector(".clear")!.addEventListener("click", () => {
      this.pre.textContent = "";
      this.lines = 0;
    });
  }

  attach(badge: Badge): void {
    badge.on("log", (e) => this.add(e.detail));
    badge.on("frame", (e) => {
      const { raw, parsed } = e.detail;
      if (parsed.text === "{GetPacketSuccess}" && this.querySelector<HTMLInputElement>(".acks")!.checked) return;
      this.add(`<- ${toHex(raw)}  hdr=${toHex(parsed.header)} text=${JSON.stringify(parsed.text)}`);
    });
    badge.on("packet", (e) => {
      const { index, total, raw } = e.detail;
      if (index < SHOW_PACKETS || index === total - 1) this.add(`-> [${index + 1}/${total}] ${toHex(raw)}`);
      else if (index === SHOW_PACKETS) this.add(`-> … ${total - SHOW_PACKETS - 1} more packets …`);
    });
  }

  add(line: string): void {
    const stamp = new Date().toISOString().slice(11, 23);
    this.pre.textContent += `${stamp} ${line}\n`;
    if (++this.lines > MAX_LINES) {
      const t = this.pre.textContent;
      this.pre.textContent = t.slice(t.indexOf("\n", t.length / 2) + 1);
      this.lines = MAX_LINES / 2;
    }
    this.pre.scrollTop = this.pre.scrollHeight;
  }
}

customElements.define("debug-log", DebugLog);
