/**
 * <badge-connect> — connect/disconnect button plus the device's info readout.
 *
 * Owns nothing but the UI: it is handed a Badge and reflects its events. The connect
 * click is the user gesture Chrome requires before `requestDevice` may run, so the
 * Badge.connect() call has to originate here, not from a timer or a drop handler.
 */

import type { Badge } from "../ble/badge.js";
import type { DeviceInfo } from "../protocol/packet.js";

export class BadgeConnect extends HTMLElement {
  private badge: Badge | null = null;
  private button!: HTMLButtonElement;
  private status!: HTMLElement;
  private infoEl!: HTMLElement;

  connectedCallback(): void {
    this.innerHTML = `
      <button type="button" class="primary">Connect badge</button>
      <span class="status" aria-live="polite">not connected</span>
      <dl class="info" hidden>
        <dt>Name</dt><dd data-f="name"></dd>
        <dt>Size</dt><dd data-f="size"></dd>
        <dt>Free</dt><dd data-f="free"></dd>
        <dt>Pacing</dt><dd data-f="gap"></dd>
        <dt>ID</dt><dd data-f="add"></dd>
      </dl>`;
    this.button = this.querySelector("button")!;
    this.status = this.querySelector(".status")!;
    this.infoEl = this.querySelector(".info")!;
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
      this.status.textContent = `error: ${(e as Error).message}`;
      this.setState(false);
    } finally {
      this.button.disabled = false;
    }
  }

  private setState(connected: boolean): void {
    this.button.textContent = connected ? "Disconnect" : "Connect badge";
    this.status.textContent = connected ? `connected to ${this.badge?.name ?? "badge"}` : "not connected";
    if (!connected) this.infoEl.hidden = true;
    this.dispatchEvent(new CustomEvent("connection", { detail: connected, bubbles: true }));
  }

  private showInfo(info: DeviceInfo): void {
    const set = (f: string, v: string) => (this.querySelector<HTMLElement>(`[data-f="${f}"]`)!.textContent = v);
    set("name", this.badge?.name ?? "");
    set("size", info.size.replace(",", "×"));
    set("free", `${info.freespace} KB${info.allspace ? ` of ${info.allspace} KB` : ""}`);
    set("gap", `${info.time_mode === 1 ? 10 : 80} ms (time_mode ${info.time_mode})`);
    set("add", info.ADD);
    this.infoEl.hidden = false;
  }
}

customElements.define("badge-connect", BadgeConnect);
