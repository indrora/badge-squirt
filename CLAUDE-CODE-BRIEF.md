# Brief: Web Bluetooth uploader for the DZBJ- digital badge

Build a small TypeScript web app (Vite + vanilla TS or minimal framework, your call)
that uploads a still image to a "DZBJ-" BLE badge from Chrome using Web Bluetooth.
Reference docs in this folder:

- `dzbj-badge-ble-protocol.md` — full wire protocol (authoritative)
- `dzbj.py` — working Python/bleak reference implementation of connect + upload

## Scope (v1)
1. Connect: `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "DZBJ-" }], optionalServices: ["000001c0-0000-1000-8000-00805f9b34fb"] })`.
   Write char `000001c1-…`, notify char `000001c2-…`.
2. On connect, subscribe to notifications first; the device pushes an info JSON
   (`{"type":13,"size":"368,368","freespace":<KB>,"time_mode":0,"ADD":"…"}`) shortly after.
   Notifications are: 5 header bytes | ASCII text | 1 checksum byte. Text is either
   `{GetPacketSuccess}`, `{GetPacketFail}`, or JSON. Log every raw frame to a debug pane.
3. Image: drag/drop or file picker → draw to canvas at the device-reported size
   (default 368×368, square, respect it — panel is round so show a circular preview)
   → export baseline JPEG, quality ~1.0 (`canvas.toBlob("image/jpeg", 1.0)`).
   Optional: quality slider and a live "bytes / KB free" readout.
4. Wrap: 36-byte `IMB\0` header + JPEG (layout in the protocol doc), then the
   envelope `{"type":6,"data":` + blob + `}`, fragment into 496-byte chunks, each in a
   `C0 | 06 | total(u16 BE) | remaining(u16 BE, counts down to 0) | len(u16 BE) | payload | sum-to-zero checksum`
   packet. Use `writeValueWithResponse`, 80 ms between packets (10 ms if `time_mode === 1`).
   Abort on `{GetPacketFail}`. Progress bar.
5. Free-space check: `ceil(len/1024) <= freespace` before sending; allow override.

## Non-goals for v1
- No list/delete: the protocol has none (the vendor app's "My Image" gallery is phone-local).
  Deletion is done on the badge itself. This is a push-only "squirt" tool.
- No multi-frame/GIF yet — but structure the packer so the `0x12345678` frame-pack
  container (documented) can be added as a second command later.

## Constraints / gotchas
- Web Bluetooth: Chrome/Edge only, needs `https://` or `localhost`, user gesture to pair.
- Keep the packet layer pure and unit-tested (checksum, fragment countdown, IMB header)
  with test vectors from `dzbj.py` — e.g. `{"type":7}` packs to
  `c00700000000000a7b2274797065223a377dc0`.
- Show raw hex of the first few packets in the debug pane; it's how we'll compare
  against the vendor app if the device rejects something.
