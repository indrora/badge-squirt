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
      <p class="ritual">Press the button on the badge, then connect within a few seconds. Chrome will show a chooser; pick the one starting <code>DZB</code>.</p>
      <div class="vstack gap-2">
        <button type="button">Connect badge</button>
        <span class="status text-light" aria-live="polite">not connected</span>
      </div>
      <dl class="info mt-4" hidden>
        <dt>Name</dt><dd data-f="name"></dd>
        <dt>Panel</dt><dd data-f="size"></dd>
        <dt>Pacing</dt><dd data-f="gap"></dd>
        <dt>ID</dt><dd data-f="add"></dd>
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
    badge.on("disconnected", () => this.setState(false));
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
      this.status.textContent = /cancel|chooser/i.test(msg)
        ? "no badge chosen — press its button and try again"
        : `could not connect: ${msg}`;
      this.setState(false);
    } finally {
      this.button.disabled = false;
    }
  }

  /** Reflect connection state in the rail; public so demo mode can drive it like connect() does. */
  setState(connected: boolean): void {
    this.button.textContent = connected ? "Disconnect" : "Connect badge";
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
    const set = (f: string, v: string) => (this.querySelector<HTMLElement>(`[data-f="${f}"]`)!.textContent = v);
    set("name", this.badge?.name ?? "");
    set("size", `${info.size.replace(",", "×")} px, round`);
    set("gap", `${info.time_mode === 1 ? 10 : 80} ms per packet`);
    set("add", info.ADD);
    this.infoEl.hidden = false;
  }
}

customElements.define("badge-connect", BadgeConnect);
