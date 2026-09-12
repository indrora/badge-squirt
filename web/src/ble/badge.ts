/**
 * badge.ts — Web Bluetooth session with a DZBJ- badge.
 *
 * Lessons baked in from the Python tool (py_tool/dzbj.py), all hardware-verified:
 *
 *  1. Do NOT look the characteristics up by the UUIDs in the vendor app (01C0/01C1/01C2).
 *     Real hardware (DZBJ-TV07) has no such service. It exposes two Jieli-style vendor
 *     services, AE30 and AE3A; the pair that works is AE3B (write-without-response) +
 *     AE3C (notify). AE02 advertises notify but rejects its CCCD write. So: try every
 *     notify characteristic until one subscribes, then pick a write characteristic from
 *     the *same* service.
 *  2. The write characteristic only supports write-without-response. Chrome's
 *     `writeValueWithoutResponse` applies back-pressure internally (unlike bleak on
 *     CoreBluetooth, which silently dropped packets), but we still pace writes as the
 *     vendor app does: 80 ms, or 10 ms when the badge reports time_mode == 1.
 *  3. The badge pushes its info JSON (type 13) unsolicited a moment after notifications
 *     are enabled. Subscribe first, then wait for it; it carries size, free space and
 *     time_mode. No per-packet acks are ever seen on this firmware — don't wait for any.
 *  4. Everything the badge says goes out as a "frame" event so the debug pane can show
 *     raw hex; comparing bytes with the vendor app is how disagreements get settled.
 */

import {
  ALBUM_CHUNK,
  TYPE,
  fragment,
  imbContainer,
  isDeviceInfo,
  parseNotification,
  parseSize,
  toHex,
  type DeviceInfo,
  type Notification,
} from "../protocol/packet.js";

/** The badge advertises AF30; the vendor app's 01C0 is kept for firmware that has it. */
export const ADV_SERVICE = 0xaf30;
export const OPTIONAL_SERVICES = [
  "000001c0-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000ae3a-0000-1000-8000-00805f9b34fb",
  "0000af30-0000-1000-8000-00805f9b34fb",
];
const UUID_WRITE = "000001c1-0000-1000-8000-00805f9b34fb";
const UUID_NOTIFY = "000001c2-0000-1000-8000-00805f9b34fb";

export interface UploadProgress {
  sent: number; // packets written so far
  total: number; // packets in this image
  bytes: number; // payload bytes written so far
  totalBytes: number;
}

export type BadgeEventMap = {
  log: CustomEvent<string>;
  frame: CustomEvent<{ raw: Uint8Array; parsed: Notification }>;
  info: CustomEvent<DeviceInfo>;
  progress: CustomEvent<UploadProgress>;
  disconnected: CustomEvent<void>;
  packet: CustomEvent<{ index: number; total: number; raw: Uint8Array }>;
};

/** EventTarget with typed `addEventListener` for the events above. */
export class Badge extends EventTarget {
  device: BluetoothDevice | null = null;
  info: DeviceInfo | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private failed = false;
  private aborted = false;

  /** Typed subscription helper; EventTarget's own addEventListener signature can't be narrowed. */
  on<K extends keyof BadgeEventMap>(type: K, listener: (ev: BadgeEventMap[K]) => void): void {
    this.addEventListener(type, listener as EventListener);
  }

  private emit<K extends keyof BadgeEventMap>(type: K, detail: BadgeEventMap[K]["detail"]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private log(msg: string): void {
    this.emit("log", msg);
  }

  get connected(): boolean {
    return !!this.server?.connected;
  }

  get name(): string {
    return this.device?.name ?? "";
  }

  /** Effective packet gap in ms, per the vendor app's rule. */
  get packetGapMs(): number {
    return this.info?.time_mode === 1 ? 10 : 80;
  }

  get size(): { width: number; height: number } {
    return this.info ? parseSize(this.info) : { width: 368, height: 368 };
  }

  static get supported(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  /**
   * Must be called from a user gesture (Chrome requirement). The ADV carries the
   * *shortened* name "DZB"; the full "DZBJ-…" only comes in the scan response, so
   * filter on the short prefix and on the advertised service UUID.
   */
  async connect(): Promise<void> {
    if (!Badge.supported) throw new Error("Web Bluetooth is not available in this browser (use Chrome/Edge over https or localhost)");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "DZB" }, { services: [ADV_SERVICE] }],
      optionalServices: OPTIONAL_SERVICES,
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.log("badge disconnected");
      this.failed = true;
      this.emit("disconnected", undefined);
    });
    this.log(`connecting to ${this.device.name ?? this.device.id}`);
    this.server = await this.device.gatt!.connect();
    this.log("connected; discovering services");
    await this.resolveCharacteristics();
    await this.waitForInfo(4000);
  }

  async disconnect(): Promise<void> {
    try {
      await this.notifyChar?.stopNotifications();
    } catch {
      /* already gone */
    }
    this.server?.disconnect();
    this.server = null;
    this.writeChar = this.notifyChar = null;
  }

  /** Mirror of Badge._resolve_chars/_subscribe in the Python tool. */
  private async resolveCharacteristics(): Promise<void> {
    const services = await this.server!.getPrimaryServices();
    const all: BluetoothRemoteGATTCharacteristic[] = [];
    for (const s of services) {
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await s.getCharacteristics();
      } catch {
        continue;
      }
      for (const c of chars) {
        all.push(c);
        this.log(`  ${short(s.uuid)}/${short(c.uuid)} ${props(c)}`);
      }
    }

    const notifyCandidates = all
      .filter((c) => c.properties.notify || c.properties.indicate)
      .sort((a, b) => Number(b.uuid === UUID_NOTIFY) - Number(a.uuid === UUID_NOTIFY));
    const errors: string[] = [];
    for (const c of notifyCandidates) {
      try {
        await c.startNotifications();
        c.addEventListener("characteristicvaluechanged", this.onNotify);
        this.notifyChar = c;
        this.log(`notify on ${short(c.uuid)}`);
        break;
      } catch (e) {
        errors.push(`${short(c.uuid)}: ${(e as Error).message}`);
      }
    }
    if (!this.notifyChar) throw new Error(`no characteristic accepted notifications:\n${errors.join("\n")}`);

    // Prefer a write characteristic in the same service as the working notify one,
    // canonical UUID first, else any writable one anywhere.
    const writable = (c: BluetoothRemoteGATTCharacteristic) => c.properties.write || c.properties.writeWithoutResponse;
    const sameService = all.filter((c) => c.service.uuid === this.notifyChar!.service.uuid && writable(c));
    this.writeChar =
      sameService.find((c) => c.uuid === UUID_WRITE) ?? sameService[0] ?? all.find((c) => c.uuid === UUID_WRITE) ?? all.find(writable) ?? null;
    if (!this.writeChar) throw new Error("no writable characteristic found");
    this.log(`write on ${short(this.writeChar.uuid)} ${props(this.writeChar)}`);
  }

  private onNotify = (ev: Event): void => {
    const view = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) return;
    const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const parsed = parseNotification(raw);
    this.emit("frame", { raw, parsed });
    if (parsed.text === "{GetPacketFail}") {
      this.failed = true;
      this.log("badge reported {GetPacketFail}");
    } else if (isDeviceInfo(parsed.json)) {
      this.info = parsed.json;
      this.emit("info", parsed.json);
    }
  };

  private async waitForInfo(timeoutMs: number): Promise<void> {
    const t0 = performance.now();
    while (!this.info && performance.now() - t0 < timeoutMs && this.connected) await sleep(100);
    if (!this.info) this.log("no info report received; assuming 368×368, 80 ms pacing");
  }

  /** Write one packet, honouring which write flavour the characteristic supports. */
  private async write(pkt: Uint8Array): Promise<void> {
    const c = this.writeChar!;
    // Copy into a fresh ArrayBuffer-backed view: subarray()s of the fragment stream carry an
    // offset, and TS 5.7 types them as Uint8Array<ArrayBufferLike>, which is not a BufferSource.
    const buf = new Uint8Array(pkt);
    if (c.properties.write && !c.properties.writeWithoutResponse) await c.writeValueWithResponse(buf);
    else await c.writeValueWithoutResponse(buf);
  }

  abort(): void {
    this.aborted = true;
  }

  /**
   * Upload one still image as ALBUM (type 6). `jpeg` must already be at `size`.
   * Resolves when the last packet is written; the badge shows "Updating…" and renders
   * on its own, with no completion frame. Several calls may share one connection —
   * leave ~2 s between them for the badge to write flash.
   */
  async uploadStill(jpeg: Uint8Array, opts: { gapMs?: number; chunk?: number } = {}): Promise<void> {
    if (!this.connected || !this.writeChar) throw new Error("not connected");
    const { width, height } = this.size;
    const blob = imbContainer(jpeg, width, height);
    const packets = fragment(TYPE.ALBUM, blob, opts.chunk ?? ALBUM_CHUNK);
    const gap = opts.gapMs ?? this.packetGapMs;
    const totalBytes = packets.reduce((n, p) => n + p.length, 0);
    this.failed = false;
    this.aborted = false;
    this.log(`uploading ${jpeg.length} B JPEG as ${packets.length} packets, ${gap} ms apart`);

    let bytes = 0;
    for (let i = 0; i < packets.length; i++) {
      if (this.failed) throw new Error(`transfer failed before packet ${i + 1}/${packets.length}`);
      if (this.aborted) throw new Error("aborted");
      const p = packets[i]!;
      this.emit("packet", { index: i, total: packets.length, raw: p });
      await this.write(p);
      bytes += p.length;
      this.emit("progress", { sent: i + 1, total: packets.length, bytes, totalBytes });
      await sleep(gap);
    }
    await sleep(500);
    if (this.failed) throw new Error("badge reported failure after the last packet");
    this.log("upload finished");
  }
}

function short(uuid: string): string {
  return uuid.startsWith("0000") && uuid.endsWith("-0000-1000-8000-00805f9b34fb") ? uuid.slice(4, 8) : uuid;
}

function props(c: BluetoothRemoteGATTCharacteristic): string {
  const p = c.properties;
  return [p.read && "read", p.write && "write", p.writeWithoutResponse && "write-no-rsp", p.notify && "notify", p.indicate && "indicate"]
    .filter(Boolean)
    .join(",");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { toHex };
