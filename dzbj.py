#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22", "pillow>=10"]
# ///
"""
dzbj.py — minimal BLE client for the "DZBJ-" digital display badge (E-Goods app protocol).

  uv run dzbj.py dump                     # connect, print every GATT service/characteristic
  uv run dzbj.py info                     # connect, print the device's info report
  uv run dzbj.py add photo.png            # upload one still (ALBUM, type 6)
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

NAME_PREFIX = "DZBJ-"
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
    def __init__(self, verbose: bool = False):
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
            lambda d, ad: bool((d.name or ad.local_name or "").startswith(NAME_PREFIX)), timeout=15.0
        )
        if dev is None:
            sys.exit(f"no device named {NAME_PREFIX}* found")
        print(f"connecting to {dev.name} ({dev.address})", file=sys.stderr)
        self.client = BleakClient(dev, timeout=20.0)
        await self.client.connect()
        try:
            mtu = self.client.mtu_size
        except Exception:
            mtu = None
        print(f"connected, mtu={mtu}", file=sys.stderr)
        self._resolve_chars()
        await self.client.start_notify(self.notify_char, self._on_notify)
        # device pushes its info JSON shortly after notify is enabled
        for _ in range(40):
            if self.info:
                break
            await asyncio.sleep(0.1)
        return self

    async def __aexit__(self, *exc):
        if self.client and self.client.is_connected:
            try:
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
        self.notify_char = find(UUID_NOTIFY, ("notify", "indicate"))
        if self.write_char is None or self.notify_char is None:
            print(self.gatt_dump(), file=sys.stderr)
            sys.exit(f"could not resolve write/notify characteristics "
                     f"(write={self.write_char}, notify={self.notify_char}); GATT table above")
        print(f"write char  {self.write_char.uuid} {self.write_char.properties}", file=sys.stderr)
        print(f"notify char {self.notify_char.uuid} {self.notify_char.properties}", file=sys.stderr)

    def gatt_dump(self) -> str:
        lines = []
        for sv in self.client.services:
            lines.append(f"service {sv.uuid}  {sv.description}")
            for ch in sv.characteristics:
                lines.append(f"  char {ch.uuid}  handle={ch.handle}  props={','.join(ch.properties)}")
                for d in ch.descriptors:
                    lines.append(f"    desc {d.uuid}  handle={d.handle}")
        return "\n".join(lines)

    def _on_notify(self, _sender, data: bytearray):
        data = bytes(data)
        self.log.append((time.time(), data))
        hdr, text = parse_notification(data)
        if self.verbose:
            print(f"<- {data.hex()}  hdr={hdr.hex()} text={text!r}", file=sys.stderr)
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
        # app: writeNoResponse on Android, write-with-response on iOS. Response=True is the
        # safe choice on macOS/CoreBluetooth where MTU can't be set explicitly.
        await self.client.write_gatt_char(self.write_char, pkt, response=True)

    async def send_packets(self, pkts: list[bytes], gap: float):
        self.failed.clear()
        for i, p in enumerate(pkts, 1):
            if self.failed.is_set():
                sys.exit(f"device reported {{GetPacketFail}} before packet {i}/{len(pkts)}")
            await self.write(p)
            print(f"\r{i}/{len(pkts)} packets", end="", file=sys.stderr)
            await asyncio.sleep(gap)
        print(file=sys.stderr)
        await asyncio.sleep(0.5)
        if self.failed.is_set():
            sys.exit("device reported {GetPacketFail}")


# ----------------------------------------------------------------------------- commands

async def cmd_dump(args):
    async with Badge(verbose=args.verbose) as b:
        print(b.gatt_dump())


async def cmd_info(args):
    async with Badge(verbose=args.verbose) as b:
        if b.info:
            print(json.dumps(b.info, indent=2))
            print(f"\nfree space: {b.info.get('freespace')} KB, image target: {b.size[0]}x{b.size[1]}")
        else:
            print("no info report received (device sends it unsolicited after notify is enabled)")
        print("\nNote: the known protocol has no command to list images; this is all the device reports.")


async def cmd_add(args):
    async with Badge(verbose=args.verbose) as b:
        w, h = b.size
        jpeg = prepare_jpeg(args.image, w, h, args.quality)
        blob = imb_container(jpeg, w, h)
        need_kb = math.ceil(len(blob) / 1024)
        free = (b.info or {}).get("freespace")
        print(f"jpeg {len(jpeg)} B, container {len(blob)} B (~{need_kb} KB), device free {free} KB", file=sys.stderr)
        if isinstance(free, int) and need_kb > free and not args.force:
            sys.exit("not enough free space on device (use --force to send anyway)")
        gap = 0.01 if (b.info or {}).get("time_mode") == 1 else PACKET_GAP_S
        pkts = fragment_image(TYPE["ALBUM"], blob, args.chunk)
        await b.send_packets(pkts, gap)
        print("upload finished")


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

    sub.add_parser("dump", help="print the device's GATT services/characteristics").set_defaults(fn=cmd_dump)
    sub.add_parser("info", help="print the device's info report").set_defaults(fn=cmd_info)

    p = sub.add_parser("add", help="upload one still image (ALBUM)")
    p.add_argument("image")
    p.add_argument("--quality", type=int, default=100, help="JPEG quality (app uses 100)")
    p.add_argument("--chunk", type=int, default=ALBUM_CHUNK, help="payload bytes per packet (app: 496)")
    p.add_argument("--force", action="store_true", help="skip the free-space check")
    p.set_defaults(fn=cmd_add)

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
