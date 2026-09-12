/**
 * packet.ts — pure wire-format layer for the DZBJ- badge.
 *
 * Nothing in here touches the DOM or Web Bluetooth; it is byte-in, byte-out and unit
 * tested against fixtures generated from the hardware-verified Python packer
 * (py_tool/gen_fixtures.py → test/fixtures/protocol.json). Keep it that way: if a
 * device rejects something, this is the layer we diff against the vendor app.
 *
 * Wire format (doc/dzbj-badge-ble-protocol.md §2):
 *
 *   +0  u8   0xC0            head, app → device
 *   +1  u8   type            command type (TYPE below)
 *   +2  u16  subpageTotal    BE, number of fragments (0 if unfragmented)
 *   +4  u16  curSubpage      BE, fragments REMAINING after this one (total-1 … 0)
 *   +6  u16  dataLen         BE
 *   +8  …    payload
 *   +N  u8   checksum        (256 - sum(all preceding bytes)) & 0xFF — whole packet sums to 0
 *
 * Note the countdown: the first fragment carries total-1, the last carries 0. That is
 * how the firmware knows the stream is complete; there is no explicit end-of-transfer.
 */

export const HEAD_APP_TO_DEVICE = 0xc0;
export const HEAD_DEVICE_TO_APP = 0xa0;

/** Command types as named in the vendor bundle. Only ALBUM and DYNAMIC are used for images. */
export const TYPE = {
  ACTIVATION_QUERY: 1,
  OTA_PACKAGE: 2,
  BOOT_ANIMATION: 3,
  DIAL_STYLE: 4,
  DYNAMIC_ATMOSPHERE: 5,
  ALBUM: 6,
  VERSION_QUERY: 7,
  UPDATE_ACTIVATION_TIME: 8,
  LYRICS_BACKGROUND: 9,
  MARQUEE_IMAGE: 12,
  DEVICE_INFO_SETTING: 13,
  DEVICE_ID_VERIFICATION: 14,
} as const;

/** Payload bytes per fragment. 8 B header + 496 + 1 B checksum = 505 ≤ MTU 512. */
export const ALBUM_CHUNK = 496;
/** The vendor app uses a smaller chunk for the multi-frame container. */
export const DYNAMIC_CHUNK = 426;

const encoder = new TextEncoder();
const decoder = new TextDecoder("ascii");

// ---------------------------------------------------------------------------- helpers

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Sum-to-zero checksum byte for `bytes`. */
export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return (256 - sum) & 0xff;
}

// ---------------------------------------------------------------------------- framing

/** One 0xC0 packet. `total`/`remaining` are 0 for unfragmented JSON commands. */
export function packet(type: number, payload: Uint8Array, total = 0, remaining = 0): Uint8Array {
  if (payload.length > 0xffff) throw new Error("payload too long for u16 dataLen");
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  head[0] = HEAD_APP_TO_DEVICE;
  head[1] = type;
  view.setUint16(2, total);
  view.setUint16(4, remaining);
  view.setUint16(6, payload.length);
  const body = concat(head, payload);
  return concat(body, Uint8Array.of(checksum(body)));
}

/** JSON command (types 1, 7, 8, 13, 14…): compact JSON, unfragmented. */
export function packJson(type: number, obj: Record<string, unknown>): Uint8Array {
  return packet(type, encoder.encode(JSON.stringify(obj)));
}

/**
 * Wrap a binary blob in the pseudo-JSON envelope and split into fixed-size fragments.
 * The envelope text is literally `{"type":6,"data":` even for DYNAMIC (type 5) — that's
 * what the vendor bundle hard-codes, and the firmware expects it.
 */
export function fragment(type: number, blob: Uint8Array, chunk: number): Uint8Array[] {
  const stream = concat(encoder.encode('{"type":6,"data":'), blob, encoder.encode("}"));
  if (stream.length <= chunk) return [packet(type, stream)];
  const n = Math.ceil(stream.length / chunk);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    out.push(packet(type, stream.subarray(i * chunk, (i + 1) * chunk), n, n - i - 1));
  }
  return out;
}

// ---------------------------------------------------------------------------- containers

/**
 * "IMB" still-image container (§3a). 36-byte header, all little-endian, then the JPEG.
 * Field 11 = "this is a JPEG", 100 = the quality constant the app always writes
 * (it has nothing to do with the actual encode quality).
 */
export function imbContainer(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const hdr = new Uint8Array(36);
  const v = new DataView(hdr.buffer);
  hdr.set(encoder.encode("IMB\0"), 0);
  v.setUint32(4, 0, true);
  v.setUint32(8, jpeg.length + 32, true);
  hdr[12] = 11;
  hdr[13] = 100;
  v.setUint16(14, 0, true);
  v.setUint16(16, width, true);
  v.setUint16(18, height, true);
  v.setUint32(20, 32, true);
  v.setUint32(24, jpeg.length, true);
  v.setUint32(28, 0, true);
  v.setUint32(32, 0, true);
  return concat(hdr, jpeg);
}

function fixedName(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  out.set(encoder.encode(s).subarray(0, len));
  return out;
}

/**
 * Multi-frame container (§3b) for DYNAMIC_ATMOSPHERE — slideshow / marquee / video
 * frames at a fixed interval. Not wired to the UI yet; it exists so the packer is
 * complete and fixture-tested before anyone builds a GIF path on top of it.
 *
 * Layout: 32-byte header, n × 16-byte directory, then 4-byte-aligned frame records that
 * form a circular linked list (last record points back at the first).
 */
export function framePack(jpegs: Uint8Array[], width: number, height: number, intervalMs: number): Uint8Array {
  const n = jpegs.length;
  const first = 32 + 16 * n;
  const offsets: number[] = [];
  const records: Uint8Array[] = [];
  let cur = first;
  for (const j of jpegs) {
    offsets.push(cur);
    const rec = new Uint8Array(32 + j.length + ((4 - ((32 + j.length) % 4)) % 4));
    const v = new DataView(rec.buffer);
    v.setUint32(0, cur, true);
    // +4: next-record pointer, patched below once every offset is known
    rec[8] = 11;
    rec[9] = 0;
    v.setUint16(10, 0, true);
    v.setUint16(12, width, true);
    v.setUint16(14, height, true);
    v.setUint32(16, cur + 32, true);
    v.setUint32(20, j.length, true);
    v.setUint32(24, 0, true);
    v.setUint32(28, 0, true);
    rec.set(j, 32);
    records.push(rec);
    cur += rec.length;
  }
  records.forEach((rec, i) => {
    new DataView(rec.buffer).setUint32(4, i + 1 < n ? offsets[i + 1]! : first, true);
  });

  const head = new Uint8Array(32);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 0x12345678, true);
  hv.setUint32(4, 16 * n + 24, true);
  hv.setUint32(8, n, true);
  hv.setUint32(12, intervalMs, true);
  head.set(fixedName(`output/${intervalMs}ms`, 12), 16);
  hv.setUint32(28, cur - 1, true);

  const dir = new Uint8Array(16 * n);
  const dv = new DataView(dir.buffer);
  offsets.forEach((o, i) => {
    // Only 12 chars fit, so the frame name is effectively "output/100m" — firmware doesn't care.
    dir.set(fixedName(`output/${intervalMs}ms/frame_${String(i + 1).padStart(6, "0")}.jpg`, 12), i * 16);
    dv.setUint32(i * 16 + 12, o, true);
  });

  return concat(head, dir, ...records);
}

// ---------------------------------------------------------------------------- device → app

export interface Notification {
  /** First 5 bytes: A0 | type | 00 | len u16 BE (verified once on DZBJ-TV07; treat as opaque). */
  header: Uint8Array;
  /** ASCII body with the header and trailing checksum stripped, exactly as the vendor app does. */
  text: string;
  /** Parsed JSON body when the text is an object, else null. */
  json: Record<string, unknown> | null;
}

/**
 * Split a notify frame the way the vendor app does: drop 5 header bytes and the last
 * (checksum) byte, ASCII-decode the middle. Frames shorter than 6 bytes (e.g. the bare
 * "fail" seen in the badge's receive mode) come back with empty text and the raw bytes
 * as the header so callers can still log them.
 */
export function parseNotification(data: Uint8Array): Notification {
  if (data.length < 6) return { header: data, text: "", json: null };
  const text = decoder.decode(data.subarray(5, data.length - 1));
  let json: Record<string, unknown> | null = null;
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      /* `{GetPacketSuccess}` looks like JSON but isn't; that's fine */
    }
  }
  return { header: data.subarray(0, 5), text, json };
}

/** The info report the badge pushes on subscribe (type 13). Fields the app ignores included. */
export interface DeviceInfo {
  type: 13;
  size: string; // "368,368"
  freespace: number; // KB
  allspace?: number; // KB
  time_mode: number; // 1 → 10 ms packet pacing, else 80 ms
  ADD: string; // BD address / device id
  devname?: string;
  screen?: string;
  brand?: number;
}

export function isDeviceInfo(json: Record<string, unknown> | null): json is DeviceInfo & Record<string, unknown> {
  return !!json && json["type"] === TYPE.DEVICE_INFO_SETTING && typeof json["size"] === "string";
}

export function parseSize(info: DeviceInfo): { width: number; height: number } {
  const [w, h] = info.size.split(",").map((s) => parseInt(s, 10));
  if (!w || !h) return { width: 368, height: 368 };
  return { width: w, height: h };
}
