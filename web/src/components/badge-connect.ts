/**
 * <badge-connect> — top of the hardware rail: the press-then-connect instruction, the
 * connect/disconnect button, and the device's readout once it answers.
 *
 * Owns nothing but the UI: it is handed a Badge and reflects its events. The connect
 * click is the user gesture Chrome requires before `requestDevice` may run, so the
 * Badge.connect() call has to originate here, not from a timer or a drop handler.
 *
 * The badge only advertises for a few seconds after its button is pressed, and that is
 * the single most common way a first connection fails, so the instruction is copy on the
 * rail, not a tooltip. Free space is not shown here; <space-gauge> owns it.
 */

import type { Badge } from "../ble/badge.js";
import type { DeviceInfo } from "../protocol/packet.js";

export class BadgeConnect extends HTMLElement {
  private badge: Badge | null = null;
  private button!: HTMLButtonElement;
  private status!: HTMLElement;
  private infoEl!: HTMLElement;
  private ritual!: HTMLElement;

  connectedCallback(): void {
    this.innerHTML = `
      <h2 class="rail-title">Badge</h2>
      <p class="ritual">Press the Bluetooth button on the badge, then click Connect. Select the badge starting with <code>DZB</code> in the chooser.</p>
      <div class="vstack gap-2">
        <button type="button">Connect</button>
        <span class="status text-light" aria-live="polite">not connected</span>
      </div>
      <dl class="info mt-4" hidden>
        <dt>Panel</dt><dd data-f="size"></dd>
        <dt>Transfer</dt><dd data-f="gap"></dd>
      </dl>`;
    this.button = this.querySelector("button")!;
    this.status = this.querySelector(".status")!;
    this.infoEl = this.querySelector(".info")!;
    this.ritual = this.querySelector(".ritual")!;
    this.button.addEventListener("click", () => void this.toggle());
  }

  attach(badge: Badge): void {
    this.badge = badge;
    badge.on("info", (e) => this.showInfo(e.detail));
    badge.on("disconnected", () => {
      // Mid-session drops are normal for this hardware (idle timer, walked away). Say so,
      // and the ritual copy returns beside Connect via setState.
      this.setState(false);
      this.status.textContent = "the badge disconnected — press its button, then Connect again";
    });
  }

  private async toggle(): Promise<void> {
    if (!this.badge) return;
    if (this.badge.connected) {
      await this.badge.disconnect();
      this.setState(false);
      return;
    }
    this.button.disabled = true;
    this.status.textContent = "connecting…";
    try {
      await this.badge.connect();
      this.setState(true);
    } catch (e) {
      const msg = (e as Error).message;
      const name = (e as Error).name;
      this.status.textContent =
        name === "NotFoundError" || /cancel|chooser/i.test(msg)
          ? "no badge chosen — press its button, then Connect within a few seconds"
          : /NetworkError|GATT|disconnected/i.test(msg + name)
            ? "the badge dropped the connection — press its button and try again"
            : /no characteristic|notifications/i.test(msg)
              ? "connected, but this badge speaks a protocol we don't know — see the debug log"
              : /not available|Bluetooth/i.test(msg)
                ? "this browser has no Web Bluetooth — use Chrome or Edge over https or localhost"
                : `could not connect: ${msg}`;
      this.setState(false);
    } finally {
      this.button.disabled = false;
    }
  }

  /** Reflect connection state in the rail; public so demo mode can drive it like connect() does. */
  setState(connected: boolean): void {
    this.button.textContent = connected ? "Disconnect" : "Connect";
    if (connected) this.button.dataset["variant"] = "secondary";
    else delete this.button.dataset["variant"];
    const demo = document.documentElement.dataset["demo"] === "1";
    this.status.textContent = connected
      ? `connected to ${this.badge?.name ?? "badge"}${demo ? " (demo)" : ""}`
      : this.status.textContent.startsWith("no badge") || this.status.textContent.startsWith("could not")
        ? this.status.textContent
        : "not connected";
    this.ritual.hidden = connected;
    if (!connected) this.infoEl.hidden = true;
    this.dispatchEvent(new CustomEvent("connection", { detail: connected, bubbles: true }));
  }

  private showInfo(info: DeviceInfo): void {
    // Name is already in the status line and the address is in the debug log; the rail
    // keeps only what changes what you do: the panel you are framing for, and how fast
    // sending will be. The badge's time_mode is an engineer's flag; the owner hears speed.
    const set = (f: string, v: string) => (this.querySelector<HTMLElement>(`[data-f="${f}"]`)!.textContent = v);
    set("size", `${info.size.replace(",", " × ")} px, round`);
    set("gap", info.time_mode === 1 ? "fast, ~1 s per picture" : "standard, several s per picture");
    this.infoEl.hidden = false;
  }
}

customElements.define("badge-connect", BadgeConnect);
