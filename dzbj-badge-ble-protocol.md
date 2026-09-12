# E-Goods (DZBJ-) badge — BLE protocol as implemented by e-Goods.apk v1.0.50

Source: `assets/apps/__UNI__1F52250/www/app-service.js` (uni-app/Vue bundle — all the
logic is JS; the DEX is just the DCloud runtime). Relevant modules inside the bundle:
`store/bluetooth.js`, `uni_modules/utils/imageAgreement.js`, `uni_modules/utils/gifAgreement.js`,
`components/sync-button/sync-button.vue`, `pages/index/index.vue`.

## 1. Transport

| Item | Value |
|---|---|
| Advertised name | starts with `DZBJ-` (app connects to the first one it sees) |
| Service | `000001C0-0000-1000-8000-00805F9B34FB` |
| Write char | `000001C1-…` (falls back to first char with `write` property) |
| Notify char | `000001C2-…` (falls back to first char with `notify` property) |
| MTU | requests 512 (Android/HarmonyOS; 3 s after connect) |
| Write type | `writeNoResponse` on Android, `write` on iOS |
| Pacing | app sleeps 80 ms between packets (10 ms if device reports `time_mode == 1`) |

Connect sequence: connect → wait 3 s → set MTU 512 → wait 1 s → discover chars →
enable notify on 01C2 → device unsolicitedly pushes its info JSON (type 13). The app
never sends a query; it just listens.

## 2. Packet framing (app → device), header 0xC0

```
+0  u8   0xC0            HEAD_APP_TO_DEVICE   (device→app uses 0xA0)
+1  u8   type            command type (table below)
+2  u16  subpageTotal    big-endian, number of fragments (0 if unfragmented)
+4  u16  curSubpage      big-endian, REMAINING fragments after this one (n-1 … 0); 0 if unfragmented
+6  u16  dataLen         big-endian
+8  ...  payload
+N  u8   checksum        (256 - sum(all preceding bytes)) & 0xFF  → whole packet sums to 0 mod 256
```

Note the countdown semantics: first fragment has curSubpage = total-1, last has 0.

Command types:

| # | Name | Used by app? |
|---|---|---|
| 1 | ACTIVATION_QUERY | no |
| 2 | OTA_PACKAGE | no |
| 3 | BOOT_ANIMATION | no |
| 4 | DIAL_STYLE | no |
| 5 | DYNAMIC_ATMOSPHERE | **yes** — multi-frame (slideshow/marquee/video) |
| 6 | ALBUM | **yes** — single still image |
| 7 | VERSION_QUERY | no |
| 8 | UPDATE_ACTIVATION_TIME | no (payload JSON year/mon/day/hour/min/sec) |
| 9 | LYRICS_BACKGROUND | no |
| 12 | MARQUEE_IMAGE | no (code exists: JSON `{size:[wH,wL,hH,hL],display,number}` then data) |
| 13 | DEVICE_INFO_SETTING | no (JSON `{bglight, breather, devname}`) — device→app uses 13 for its info report |
| 14 | DEVICE_ID_VERIFICATION | no (JSON `{Ret}`) |

Pure-JSON commands (1,7,8,12-info,13,14) are `packData`: payload = UTF-8 JSON, unfragmented.

## 3. Image upload payloads

Both image commands wrap a binary blob in a pseudo-JSON envelope and then fragment
the *whole* thing (envelope + binary) into fixed-size chunks:

```
payload_stream = b'{"type":6,"data":' + BLOB + b'}'
```

(Yes, `"type":6` even for DYNAMIC_ATMOSPHERE/type 5 — the envelope text is hard-coded.)

Chunk size: **496** bytes for ALBUM, **426** bytes for DYNAMIC_ATMOSPHERE. Every chunk
becomes one 0xC0 packet with subpageTotal/curSubpage set. Max on-wire packet = 8+496+1 = 505 B < MTU 512.

### 3a. Single still — ALBUM (type 6), BLOB = "IMB" container

Image is a baseline JPEG, resized to the device's reported size (default 368×368), quality 100.

```
+0   "IMB\0"
+4   u32 LE  0
+8   u32 LE  jpegLen + 32
+12  u8      11  (= JPEG; 0 otherwise)
+13  u8      100 (quality / constant)
+14  u16 LE  0
+16  u16 LE  width
+18  u16 LE  height
+20  u32 LE  32          (data offset within this record)
+24  u32 LE  jpegLen
+28  u32 LE  0
+32  u32 LE  0
+36  JPEG bytes
```

Free-space check: `ceil(len/1024) <= device.freespace` (freespace reported in KB).

### 3b. Multi-frame — DYNAMIC_ATMOSPHERE (type 5), BLOB = frame-pack container

Used for slideshow, marquee and video. Frames are JPEGs (video is decoded to frames on
the phone first), named `output/<ms>ms/frame_000001.jpg` … Interval `ms = speed*1000`
(default speed 0.1 → 100 ms).

```
Header (32 bytes):
+0   u32 LE  0x12345678
+4   u32 LE  16*n + 24            (header size as the firmware counts it)
+8   u32 LE  n                    frame count
+12  u32 LE  interval_ms
+16  char[12] folder name, NUL-padded  ("output/100ms")
+28  u32 LE  totalLen - 1         (patched at the end: final write cursor minus 1)

Directory (n × 16 bytes):
+0   char[12] frame name, NUL-padded/truncated  (only the tail of the path fits — "output/100ms/frame_000001.jpg" is truncated to 12 chars, so it's really "output/100m"; firmware evidently doesn't care)
+12  u32 LE  offset of that frame's record

Frame records, starting at 32 + 16*n, each 4-byte aligned:
+0   u32 LE  own offset
+4   u32 LE  next record's offset (last frame: points back to first record = 32+16n)
+8   u8      11 (JPEG)
+9   u8      0
+10  u16 LE  0
+12  u16 LE  width
+14  u16 LE  height
+16  u32 LE  own offset + 32      (absolute offset of JPEG data)
+20  u32 LE  jpegLen
+24  u32 LE  0
+28  u32 LE  0
+32  JPEG bytes, then pad to 4-byte boundary
```

## 4. Device → app (header 0xA0, notify on 01C2)

The app hex-encodes the notification, drops the first **10 hex chars (5 bytes)** and the
last 2 (checksum byte), and ASCII-decodes the rest. So device frames have a 5-byte
header (0xA0, type, and probably a 16-bit length + one more byte — the JS never
parses it, so the exact layout is unverified) + text + checksum.

Text bodies seen:

* `{GetPacketSuccess}` — per-packet ack (app ignores it; it does not wait for acks)
* `{GetPacketFail}` — app aborts the transfer
* JSON info report, `"type":13`, pushed on connect:
  ```json
  {"type":13, "size":"368,368", "freespace":8192, "time_mode":0, "ADD":"<device id>"}
  ```
  `size` sets the resize target for all images, `freespace` is KB, `time_mode==1`
  switches pacing to 10 ms, `ADD` is the device identifier.

## 5. Side note — telemetry

On first connection the app POSTs `{user_code:"baji", deviceId:<ADD>, deviceName, os_deviceId, os, timestamp}`
to `http://baji.gdwlong.com/baji/equipment` (plain HTTP) and caches the ID so it only does it once.

## 6. Reference packer (Python)

```python
import struct

HEAD = 0xC0
ALBUM, DYNAMIC = 6, 5

def packet(ptype, payload, total=0, remaining=0):
    p = bytes([HEAD, ptype]) + struct.pack(">HHH", total, remaining, len(payload)) + payload
    return p + bytes([(256 - sum(p)) & 0xFF])

def fragment(ptype, blob, chunk):
    stream = b'{"type":6,"data":' + blob + b'}'
    if len(stream) <= chunk:
        return [packet(ptype, stream)]
    n = -(-len(stream) // chunk)
    return [packet(ptype, stream[i*chunk:(i+1)*chunk], n, n-i-1) for i in range(n)]

def imb(jpeg, w, h):
    hdr = b"IMB\0" + struct.pack("<IIBBHHHIIII", 0, len(jpeg)+32, 11, 100, 0, w, h, 32, len(jpeg), 0, 0)
    return hdr + jpeg

def framepack(jpegs, w, h, interval_ms):
    n = len(jpegs)
    folder = f"output/{interval_ms}ms".encode()[:12].ljust(12, b"\0")
    first = 32 + 16*n
    offs, body = [], bytearray()
    cur = first
    for j in jpegs:
        offs.append(cur)
        rec = struct.pack("<IIBBHHHIIII", cur, 0, 11, 0, 0, w, h, cur+32, len(j), 0, 0) + j
        rec += b"\0" * (-len(rec) % 4)
        body += rec; cur += len(rec)
    body = bytearray(body)
    for i, o in enumerate(offs):                      # patch "next" pointers
        nxt = offs[i+1] if i+1 < n else first
        struct.pack_into("<I", body, o - first + 4, nxt)
    dirent = b"".join(f"output/{interval_ms}ms/frame_{i+1:06d}.jpg".encode()[:12].ljust(12, b"\0")
                      + struct.pack("<I", o) for i, o in enumerate(offs))
    head = struct.pack("<IIII", 0x12345678, 16*n+24, n, interval_ms) + folder + struct.pack("<I", cur-1)
    return head + dirent + bytes(body)

# still:   for p in fragment(ALBUM,   imb(jpeg, 368, 368), 496): write(p); sleep(0.08)
# frames:  for p in fragment(DYNAMIC, framepack(jpegs, 368, 368, 100), 426): write(p); sleep(0.08)
```
