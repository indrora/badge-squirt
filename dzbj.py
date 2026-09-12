#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22", "pillow>=10", "rich>=13"]
# ///
"""
dzbj.py — minimal BLE client for the "DZBJ-" digital display badge (E-Goods app protocol).

  uv run dzbj.py scan --wait 15           # dump advertisement data of everything named DZBJ-*
  uv run dzbj.py dump                     # connect, print every GATT service/characteristic
  uv run dzbj.py info                     # connect, print the device's info report
  uv run dzbj.py listen --wait 20         # connect, subscribe to everything, log all frames
  uv run dzbj.py rawsend img.jpg --container imb --envelope --framing c0 --count 3
                                          # receive-mode format probing: see cmd_rawsend
  uv run dzbj.py add a.png b.jpg ...      # upload stills (ALBUM, type 6) on one connection
  uv run dzbj.py remove NAME              # not in the known protocol — see probe
  uv run dzbj.py probe 7                  # send {"type":7} (VERSION_QUERY) and dump replies
  uv run dzbj.py probe 13 '{"devname":"x"}'  # send a JSON command with extra fields

Protocol recovered from e-Goods.apk v1.0.50; see dzbj-badge-ble-protocol.md.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import math
import struct
import sys
import time

from bleak import BleakClient, BleakScanner
from PIL import Image
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeRemainingColumn, TransferSpeedColumn

# All human-facing chatter goes to stderr via rich so stdout stays scriptable (JSON etc).
console = Console(stderr=True)

NAME_PREFIX = "DZBJ-"
# The ADV packet carries the *shortened* local name "DZB"; the full "DZBJ-TV07(BLE)" only
# arrives in the scan response, which macOS sometimes never delivers to us. Match on the
# short form and on the advertised service UUID (AF30, Jieli convention) as well.
SHORT_PREFIX = "DZB"
UUID_ADV_SERVICE = "0000af30-0000-1000-8000-00805f9b34fb"
UUID_SERVICE = "000001c0-0000-1000-8000-00805f9b34fb"
UUID_WRITE = "000001c1-0000-1000-8000-00805f9b34fb"
UUID_NOTIFY = "000001c2-0000-1000-8000-00805f9b34fb"

HEAD_APP_TO_DEVICE = 0xC0
HEAD_DEVICE_TO_APP = 0xA0

TYPE = {
    "ACTIVATION_QUERY": 1, "OTA_PACKAGE": 2, "BOOT_ANIMATION": 3, "DIAL_STYLE": 4,
    "DYNAMIC_ATMOSPHERE": 5, "ALBUM": 6, "VERSION_QUERY": 7, "UPDATE_ACTIVATION_TIME": 8,
    "LYRICS_BACKGROUND": 9, "MARQUEE_IMAGE": 12, "DEVICE_INFO_SETTING": 13,
    "DEVICE_ID_VERIFICATION": 14,
}

ALBUM_CHUNK = 496        # app uses 496 for stills (8B header + 496 + 1B checksum = 505 <= MTU 512)
JPEG_QUALITY = 70        # app uses 100, which is ~3x the bytes for no visible gain on a 368px round panel
PACKET_GAP_S = 0.08      # app sleeps 80 ms between packets (10 ms if device time_mode == 1)


# ----------------------------------------------------------------------------- framing

def packet(ptype: int, payload: bytes, total: int = 0, remaining: int = 0) -> bytes:
    p = bytes([HEAD_APP_TO_DEVICE, ptype]) + struct.pack(">HHH", total, remaining, len(payload)) + payload
    return p + bytes([(256 - sum(p)) & 0xFF])


def pack_json(ptype: int, obj: dict) -> bytes:
    return packet(ptype, json.dumps(obj, separators=(",", ":")).encode())


def fragment_image(ptype: int, blob: bytes, chunk: int) -> list[bytes]:
    stream = b'{"type":6,"data":' + blob + b"}"   # literal "type":6 even for type 5 — matches the app
    if len(stream) <= chunk:
        return [packet(ptype, stream)]
    n = math.ceil(len(stream) / chunk)
    return [packet(ptype, stream[i * chunk:(i + 1) * chunk], n, n - i - 1) for i in range(n)]


def imb_container(jpeg: bytes, w: int, h: int) -> bytes:
    hdr = b"IMB\0" + struct.pack("<IIBBHHHIIII", 0, len(jpeg) + 32, 11, 100, 0, w, h, 32, len(jpeg), 0, 0)
    return hdr + jpeg


def parse_notification(data: bytes) -> tuple[bytes, str]:
    """Return (raw 5-byte header, text). The app strips 5 header bytes + 1 trailing checksum."""
    if len(data) < 6:
        return data, ""
    return data[:5], data[5:-1].decode("ascii", errors="replace")


# ----------------------------------------------------------------------------- image prep

def prepare_jpeg(path: str, w: int, h: int, quality: int = 100) -> bytes:
    im = Image.open(path)
    im = im.convert("RGB")
    im = im.resize((w, h), Image.LANCZOS)   # app resizes to the device-reported size
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=False, progressive=False, subsampling=0)
    return buf.getvalue()


# ----------------------------------------------------------------------------- BLE session

class Badge:
    def __init__(self, verbose: bool = False, subscribe: bool = True,
                 info_wait: float = 4.0, listen_all: bool = False):
        self.subscribe = subscribe
        self.info_wait = info_wait      # receive mode never sends type 13 and drops us after ~4 s idle
        self.listen_all = listen_all    # extra CCCD writes cost time we may not have
        self.client: BleakClient | None = None
        # Resolved at connect time (see _resolve_chars); never assume the UUIDs above exist.
        self.write_char = None
        self.notify_char = None
        self.info: dict | None = None
        self.failed = asyncio.Event()
        self.verbose = verbose
        self.log: list[tuple[float, bytes]] = []

    async def __aenter__(self):
        dev = await BleakScanner.find_device_by_filter(
            lambda d, ad: (d.name or ad.local_name or "").startswith(SHORT_PREFIX)
            or UUID_ADV_SERVICE in ad.service_uuids,
            timeout=15.0,
        )
        if dev is None:
            sys.exit(f"no device named {NAME_PREFIX}* found")
        print(f"connecting to {dev.name} ({dev.address})", file=sys.stderr)
        self.client = BleakClient(dev, timeout=20.0, disconnected_callback=self._on_disconnect)
        await self.client.connect()
        try:
            mtu = self.client.mtu_size
        except Exception:
            mtu = None
        print(f"connected, mtu={mtu}", file=sys.stderr)
        if not self.subscribe:
            return self
        self._resolve_chars()
        await self._subscribe()
        # App mode: device pushes its info JSON shortly after notify is enabled.
        # Receive mode (double-tap): nothing is pushed and the badge disconnects after a few
        # seconds of silence, so callers pass info_wait=0 and start writing immediately.
        for _ in range(int(self.info_wait * 10)):
            if self.info or self.failed.is_set():
                break
            await asyncio.sleep(0.1)
        return self

    async def __aexit__(self, *exc):
        if self.client and self.client.is_connected:
            try:
                if self.notify_char is not None:
                    await self.client.stop_notify(self.notify_char)
            except Exception:
                pass
            await self.client.disconnect()

    def _resolve_chars(self):
        """
        Pick the write and notify characteristics the same way the vendor app does.

        The app (store/bluetooth.js) first looks for 01C1 / 01C2 inside service 01C0, and
        if either is missing it falls back to the *first* characteristic in that service
        with the `write` (or `writeNoResponse`) / `notify` property. Some badge firmwares
        evidently don't expose the canonical UUIDs, which is why bleak's hard-coded lookup
        blew up with "Characteristic ... not found". If even the service is missing we
        widen the search to every service, then give up with a full GATT dump so the user
        can see what the device actually advertises.
        """
        svcs = list(self.client.services)
        target = [sv for sv in svcs if sv.uuid.lower() == UUID_SERVICE] or svcs

        def find(uuid, props):
            for sv in target:
                for ch in sv.characteristics:
                    if ch.uuid.lower() == uuid:
                        return ch
            for sv in target:
                for ch in sv.characteristics:
                    if any(pr in ch.properties for pr in props):
                        return ch
            return None

        self.write_char = find(UUID_WRITE, ("write", "write-without-response"))
        # Every notify/indicate-capable characteristic, canonical UUID first, in GATT order.
        # Seen in the wild: "DZBJ-TV07(BLE)" has no 01C0 service at all. It exposes two vendor
        # services: AE30 (Jieli SPP-style: AE01 w/o-rsp, AE02 notify, AE03/AE04, AE05 indicate,
        # AE10 r/w) and AE3A (AE3B w/o-rsp, AE3C notify). AE02 rejects its CCCD write with
        # "handle is invalid"; AE3C accepts and the info report arrives on it. The write
        # characteristic is re-selected in _subscribe() to live in the same service as the
        # notify one, so we don't end up talking on AE01 while listening on AE3C.
        self.notify_candidates = [ch for sv in target for ch in sv.characteristics
                                  if "notify" in ch.properties or "indicate" in ch.properties]
        self.notify_candidates.sort(key=lambda ch: ch.uuid.lower() != UUID_NOTIFY)
        if self.write_char is None or not self.notify_candidates:
            print(self.gatt_dump(), file=sys.stderr)
            sys.exit(f"could not resolve write/notify characteristics "
                     f"(write={self.write_char}, notify candidates={self.notify_candidates}); GATT table above")
        # CoreBluetooth can't set MTU; respect what the characteristic actually supports.
        self.write_response = "write" in self.write_char.properties

    async def _subscribe(self):
        """
        Enable notifications on the first candidate that accepts a CCCD write.

        macOS caches each peripheral's GATT database. If the badge's firmware changed its
        table since the last pairing, the cached handles are wrong and CoreBluetooth answers
        the CCCD write with CBATTErrorDomain code 1 "The handle is invalid". Nothing in
        userland can flush that cache: toggle Bluetooth off/on in Control Center (or
        `sudo pkill bluetoothd`) and reconnect. We surface that hint instead of a traceback.
        """
        errors = []
        for ch in self.notify_candidates:
            try:
                await self.client.start_notify(ch, self._on_notify)
                self.notify_char = ch
                # Prefer a write characteristic from the same service as the working notify one.
                sibling = next((c for c in self.client.services.get_service(ch.service_handle).characteristics
                                if "write" in c.properties or "write-without-response" in c.properties), None)
                if sibling is not None:
                    self.write_char = sibling
                    self.write_response = "write" in sibling.properties
                print(f"notify char {ch.uuid} {ch.properties}", file=sys.stderr)
                print(f"write char  {self.write_char.uuid} {self.write_char.properties} "
                      f"(response={self.write_response})", file=sys.stderr)
                # Best effort: also listen on every other notify char (AE02/AE04/AE05) so we
                # can see which one the per-packet acks come out of. Failures are fine.
                for extra in (self.notify_candidates if self.listen_all else []):
                    if extra is ch:
                        continue
                    try:
                        await self.client.start_notify(extra, self._on_notify)
                        print(f"also listening on {extra.uuid}", file=sys.stderr)
                    except Exception as exc:  # noqa: BLE001
                        print(f"  (no notify on {extra.uuid}: {exc})", file=sys.stderr)
                return
            except Exception as exc:  # noqa: BLE001 — bleak raises its own hierarchy
                errors.append(f"  {ch.uuid} handle={ch.handle}: {exc}")
        print(self.gatt_dump(), file=sys.stderr)
        sys.exit("could not enable notifications on any characteristic:\n" + "\n".join(errors)
                 + "\nIf the error is 'The handle is invalid', macOS has a stale GATT cache for this"
                 " badge: toggle Bluetooth off and on (or `sudo pkill bluetoothd`) and retry.")

    def gatt_dump(self) -> str:
        lines = []
        for sv in self.client.services:
            lines.append(f"service {sv.uuid}  {sv.description}")
            for ch in sv.characteristics:
                lines.append(f"  char {ch.uuid}  handle={ch.handle}  props={','.join(ch.properties)}")
                for d in ch.descriptors:
                    lines.append(f"    desc {d.uuid}  handle={d.handle}")
        return "\n".join(lines)

    def _on_disconnect(self, _client):
        # The badge drops the link itself in several situations (receive-mode timeout,
        # foreign central, or just its idle timer). Say so instead of letting bleak raise
        # "Service Discovery has not been performed yet" from the next call.
        print(f"\n!! badge disconnected after {len(self.log)} frame(s)", file=sys.stderr)
        self.failed.set()

    def _on_notify(self, _sender, data: bytearray):
        data = bytes(data)
        self.log.append((time.time(), data))
        hdr, text = parse_notification(data)
        if self.verbose:
            print(f"<- [{_sender.uuid[4:8]}] {data.hex()}  hdr={hdr.hex()} text={text!r}", file=sys.stderr)
        if text == "{GetPacketSuccess}":
            return
        if text == "{GetPacketFail}":
            self.failed.set()
            return
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            return
        if isinstance(obj, dict) and obj.get("type") == TYPE["DEVICE_INFO_SETTING"]:
            self.info = obj

    @property
    def size(self) -> tuple[int, int]:
        try:
            w, h = (int(x) for x in self.info["size"].split(","))
            return w, h
        except Exception:
            return 368, 368

    async def write(self, pkt: bytes):
        """
        Write one packet, honouring CoreBluetooth's write-without-response flow control.

        The badge's write characteristic only supports write-without-response. bleak's
        CoreBluetooth backend hands those straight to CBPeripheral.writeValue without checking
        `canSendWriteWithoutResponse`; when the OS-side queue is full the write is *silently
        dropped*. At the app's 10 ms pacing with 505-byte packets (3 LL PDUs each) that queue
        overflows almost immediately, the badge sees a stream with holes, shows "Updating..."
        and then never renders. So on macOS we poll the ready flag before every write. Other
        backends (BlueZ/WinRT) apply back-pressure themselves; the hasattr guard skips them.
        """
        if not self.write_response:
            periph = getattr(getattr(self.client, "_backend", None), "_peripheral", None)
            if periph is not None and hasattr(periph, "canSendWriteWithoutResponse"):
                for _ in range(500):            # 5 s worst case, then write anyway
                    if periph.canSendWriteWithoutResponse():
                        break
                    await asyncio.sleep(0.01)
        await self.client.write_gatt_char(self.write_char, pkt, response=self.write_response)

    async def send_packets(self, pkts: list[bytes], gap: float, progress: Progress | None = None,
                           label: str = "upload"):
        """Stream packets with pacing; draws a rich bar on `progress` if given."""
        self.failed.clear()
        total_bytes = sum(len(p) for p in pkts)
        own = progress is None
        if own:
            progress = make_progress()
            progress.start()
        task = progress.add_task(label, total=total_bytes)
        try:
            for i, p in enumerate(pkts, 1):
                if self.failed.is_set():
                    sys.exit(f"device reported {{GetPacketFail}} or disconnected before packet {i}/{len(pkts)}")
                await self.write(p)
                progress.update(task, advance=len(p))
                await asyncio.sleep(gap)
            await asyncio.sleep(0.5)
        finally:
            if own:
                progress.stop()
        if self.failed.is_set():
            sys.exit("device reported {GetPacketFail}")


def make_progress() -> Progress:
    return Progress(
        TextColumn("[bold]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    )


# ----------------------------------------------------------------------------- commands

async def cmd_scan(args):
    """
    Print every advertisement whose name matches --prefix (default DZBJ-), with all the
    fields CoreBluetooth exposes. Used to learn what a badge in "waiting to receive" mode
    advertises so fakebadge.py can mimic it (the sharing badge connects to "the first badge
    that listens", so it must be filtering on name, service UUID or manufacturer data).
    """
    seen: dict[str, str] = {}

    def cb(dev, ad):
        name = dev.name or ad.local_name or ""
        vendor = any(u[4:6] in ("ae", "af") for u in ad.service_uuids)
        if not name.startswith(args.prefix) and not (args.all and vendor) and UUID_ADV_SERVICE not in ad.service_uuids:
            return
        desc = (f"name={name!r} rssi={ad.rssi} services={ad.service_uuids} "
                f"mfg={{{', '.join(f'{k:#06x}: {v.hex()}' for k, v in ad.manufacturer_data.items())}}} "
                f"svcdata={{{', '.join(f'{k}: {v.hex()}' for k, v in ad.service_data.items())}}} "
                f"tx={ad.tx_power}")
        if seen.get(dev.address) != desc:
            seen[dev.address] = desc
            print(f"{dev.address}  {desc}")

    async with BleakScanner(cb):
        await asyncio.sleep(args.wait)
    if not seen:
        print(f"nothing named {args.prefix}* seen in {args.wait}s")


async def cmd_dump(args):
    async with Badge(verbose=args.verbose, subscribe=False) as b:
        print(b.gatt_dump())


async def cmd_listen(args):
    """
    Passive capture: connect, subscribe to every notify/indicate characteristic, send
    nothing, print every frame with its source characteristic. Meant for poking at the
    badge's own modes (double-tap "waiting to receive", long-press "share") where the
    GATT table and any unsolicited handshake differ from the app-facing mode.
    """
    async with Badge(verbose=True, listen_all=True) as b:
        if not b.client.is_connected:
            sys.exit("badge disconnected before service discovery finished")
        print(b.gatt_dump())
        print(f"listening {args.wait}s ...", file=sys.stderr)
        before = len(b.log)
        for _ in range(int(args.wait * 10)):
            if b.failed.is_set():
                break
            await asyncio.sleep(0.1)
        print(f"{len(b.log) - before} frame(s) received while listening")


async def cmd_info(args):
    async with Badge(verbose=args.verbose) as b:
        if b.info:
            print(json.dumps(b.info, indent=2))
            print(f"\nfree space: {b.info.get('freespace')} KB, image target: {b.size[0]}x{b.size[1]}")
        else:
            print("no info report received (device sends it unsolicited after notify is enabled)")
        print("\nNote: the known protocol has no command to list images; this is all the device reports.")


async def cmd_add(args):
    async with Badge(verbose=args.verbose, info_wait=0.0 if args.no_wait else 4.0,
                     listen_all=args.listen_all) as b:
        if b.failed.is_set():
            sys.exit("badge disconnected during connect/subscribe")
        w, h = b.size
        gap = args.gap if args.gap is not None else (0.01 if (b.info or {}).get("time_mode") == 1 else PACKET_GAP_S)
        free = (b.info or {}).get("freespace")
        # Several images ride the same connection: connect/subscribe costs seconds and the
        # badge's idle timer is short, so re-dialling per image is the worst of both worlds.
        # After each upload the badge shows "Updating..." while it writes flash and renders;
        # --pause gives it that time before the next stream starts (no ack to wait for).
        with make_progress() as progress:
            overall = progress.add_task("images", total=len(args.image)) if len(args.image) > 1 else None
            for idx, image in enumerate(args.image, 1):
                jpeg = prepare_jpeg(image, w, h, args.quality)
                blob = imb_container(jpeg, w, h)
                need_kb = math.ceil(len(blob) / 1024)
                console.print(f"[cyan]{image}[/]: jpeg {len(jpeg):,} B at q{args.quality}, "
                              f"~{need_kb} KB, device free {free} KB")
                if isinstance(free, int) and need_kb > free and not args.force:
                    sys.exit("not enough free space on device (use --force to send anyway)")
                pkts = fragment_image(TYPE["ALBUM"], blob, args.chunk)
                await b.send_packets(pkts, gap, progress, label=image)
                if isinstance(free, int):
                    free -= need_kb           # device never re-reports; keep our own estimate
                if overall is not None:
                    progress.update(overall, advance=1)
                if idx < len(args.image):
                    await asyncio.sleep(args.pause)
        console.print(f"[green]done[/]: {len(args.image)} image(s) uploaded")


async def cmd_rawsend(args):
    """
    Format probe for the badge's double-tap "waiting to receive" mode.

    Receive mode does not speak the app protocol: pushing the normal 0xC0-framed
    '{"type":6,"data":<IMB>}' stream got a bare ASCII "fail" on AE02 after ~4 packets and a
    disconnect. Replies there are unframed text, so the expected input is probably simpler
    too. This command builds the payload from switches so each double-tap tests one guess:

      --container imb|jpeg|none   IMB\0 header + JPEG, bare JPEG, or --text only
      --envelope / --no-envelope  wrap in '{"type":6,"data":' ... '}'
      --framing c0|none           0xC0 fragment packets, or raw chunks
      --chunk N --count K         chunk size and how many chunks to send (0 = all)
      --text STR                  send this UTF-8 string first (handshake guesses)
      --wait S                    seconds to collect replies after the last write
    """
    from pathlib import Path
    blob = b""
    if args.container != "none":
        w, h = 368, 368
        jpeg = prepare_jpeg(args.image, w, h, args.quality)
        blob = imb_container(jpeg, w, h) if args.container == "imb" else jpeg
    if args.envelope:
        blob = b'{"type":6,"data":' + blob + b"}"
    if args.framing == "c0":
        n = math.ceil(len(blob) / args.chunk) if blob else 0
        chunks = [packet(TYPE["ALBUM"], blob[i * args.chunk:(i + 1) * args.chunk], n, n - i - 1) for i in range(n)]
    else:
        chunks = [blob[i:i + args.chunk] for i in range(0, len(blob), args.chunk)]
    if args.count:
        chunks = chunks[:args.count]
    # Handshake guesses go first, each followed by a pause so a reply can be attributed.
    texts = [t.encode() for t in (args.text or [])]
    print(f"payload {len(blob)} B -> {len(chunks)} chunk(s); first: {chunks[0][:48].hex() if chunks else '-'}", file=sys.stderr)

    async with Badge(verbose=True, info_wait=0.0) as b:
        if b.failed.is_set():
            sys.exit("badge disconnected during connect/subscribe")
        t0 = time.time()
        sent = 0
        for t in texts:
            if b.failed.is_set():
                break
            n_before = len(b.log)
            await b.write(t)
            print(f"-> text {t!r}", file=sys.stderr)
            await asyncio.sleep(args.textwait)
            for _, d in b.log[n_before:]:
                print(f"   <- {d.decode('ascii', errors='replace')!r}", file=sys.stderr)
        for c in chunks:
            if b.failed.is_set():
                break
            await b.write(c)
            sent += 1
            await asyncio.sleep(args.gap)
        print(f"sent {sent}/{len(chunks)} chunk(s) in {time.time() - t0:.2f}s; waiting {args.wait}s", file=sys.stderr)
        for _ in range(int(args.wait * 10)):
            if b.failed.is_set():
                break
            await asyncio.sleep(0.1)
        for t, d in b.log:
            print(f"  +{t - t0:6.3f}s  {d.hex()}  {d.decode('ascii', errors='replace')!r}")
        print(f"{len(b.log)} reply frame(s); disconnected={b.failed.is_set()}")


async def cmd_remove(args):
    sys.exit(
        "remove: the E-Goods app never deletes anything on the device and its protocol has no\n"
        "delete/list command (the only writes it makes are the two image uploads). The firmware\n"
        "may still have one — use `probe` to try candidate commands and watch the replies."
    )


async def cmd_probe(args):
    ptype = int(args.type, 0)
    extra = json.loads(args.json) if args.json else {}
    obj = {"type": ptype, **extra}
    async with Badge(verbose=True) as b:
        before = len(b.log)
        pkt = pack_json(ptype, obj)
        print(f"-> {pkt.hex()}  {obj}", file=sys.stderr)
        await b.write(pkt)
        await asyncio.sleep(args.wait)
        replies = b.log[before:]
        print(f"{len(replies)} notification(s) after probe")
        for t, d in replies:
            hdr, text = parse_notification(d)
            print(f"  hdr={hdr.hex()} text={text!r} raw={d.hex()}")


# ----------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-v", "--verbose", action="store_true", help="dump every notification")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("scan", help="dump advertisement data of nearby badges")
    p.add_argument("--wait", type=float, default=15.0)
    p.add_argument("--prefix", default=NAME_PREFIX)
    p.add_argument("--all", action="store_true", help="also show nameless devices advertising an AExx/AFxx service")
    p.set_defaults(fn=cmd_scan)
    sub.add_parser("dump", help="print the device's GATT services/characteristics").set_defaults(fn=cmd_dump)
    sub.add_parser("info", help="print the device's info report").set_defaults(fn=cmd_info)
    p = sub.add_parser("listen", help="subscribe to everything and log frames without sending")
    p.add_argument("--wait", type=float, default=20.0, help="seconds to listen")
    p.set_defaults(fn=cmd_listen)

    p = sub.add_parser("add", help="upload one or more still images (ALBUM) on a single connection")
    p.add_argument("image", nargs="+")
    p.add_argument("--pause", type=float, default=2.0, help="seconds to let the badge render between images")
    p.add_argument("--quality", "-q", type=int, default=JPEG_QUALITY, help=f"JPEG quality 1-100 (default {JPEG_QUALITY}; app uses 100)")
    p.add_argument("--chunk", type=int, default=ALBUM_CHUNK, help="payload bytes per packet (app: 496)")
    p.add_argument("--force", action="store_true", help="skip the free-space check")
    p.add_argument("--gap", type=float, default=None, help="seconds between packets (default: 0.01 if time_mode==1 else 0.08)")
    p.add_argument("--no-wait", action="store_true", help="don't wait for the info report (badge in receive mode)")
    p.add_argument("--listen-all", action="store_true", help="also subscribe to every other notify characteristic")
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("rawsend", help="receive-mode format probe (see docstring)")
    p.add_argument("image", nargs="?", default="sniffit.jpg")
    p.add_argument("--container", choices=["imb", "jpeg", "none"], default="imb")
    p.add_argument("--envelope", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--framing", choices=["c0", "none"], default="c0")
    p.add_argument("--chunk", type=int, default=ALBUM_CHUNK)
    p.add_argument("--count", type=int, default=0, help="chunks to send (0 = all)")
    p.add_argument("--text", action="append", help="UTF-8 string to write first (repeatable, sent in order)")
    p.add_argument("--textwait", type=float, default=0.7, help="pause after each --text to collect a reply")
    p.add_argument("--gap", type=float, default=0.01)
    p.add_argument("--wait", type=float, default=3.0)
    p.add_argument("--quality", "-q", type=int, default=JPEG_QUALITY)
    p.set_defaults(fn=cmd_rawsend)

    p = sub.add_parser("remove", help="(not available in the known protocol)")
    p.add_argument("name")
    p.set_defaults(fn=cmd_remove)

    p = sub.add_parser("probe", help="send a JSON command of the given type and dump replies")
    p.add_argument("type", help="command type number, e.g. 7 or 0x0d")
    p.add_argument("json", nargs="?", help="extra JSON fields, e.g. '{\"devname\":\"foo\"}'")
    p.add_argument("--wait", type=float, default=3.0, help="seconds to collect replies")
    p.set_defaults(fn=cmd_probe)

    args = ap.parse_args()
    asyncio.run(args.fn(args))


if __name__ == "__main__":
    main()
