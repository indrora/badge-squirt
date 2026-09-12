#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["bless>=0.2.6"]
# ///
"""
fakebadge.py — impersonate a DZBJ- badge in "waiting to receive" mode so a real badge in
share mode (long-press) connects to *us* and we can log exactly what it sends.

  uv run fakebadge.py                  # advertise, log every write to stderr + capture.log
  uv run fakebadge.py --ack            # also answer every write with a {GetPacketSuccess} frame
  uv run fakebadge.py --name DZBJ-TV07 # advertised local name (default DZBJ-FAKE(BLE))

Why: the vendor app knows nothing about badge-to-badge sharing (it only ever writes the
fragmented ALBUM/DYNAMIC streams to 01C1 or, on real hardware, AE3B). The receiving badge
drops a central that subscribes and then stays silent, so the sender must open with some
handshake on the Jieli AE30 service (AE01 write / AE02 notify). Replaying what we capture
here from dzbj.py is the path to "send image to a badge sitting in receive mode".

macOS notes: CoreBluetooth peripheral mode is exposed via bless; the advertised local name
comes from CBAdvertisementDataLocalNameKey. The sharing badge presumably filters on the
"DZBJ-" prefix and/or the AE30 service UUID, so we advertise both. Run from Terminal.app
(TCC requires a host with an NSBluetoothAlwaysUsageDescription).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from typing import Any

from bless import BlessGATTCharacteristic, BlessServer, GATTAttributePermissions, GATTCharacteristicProperties

# GATT table copied from `dzbj.py dump` of DZBJ-TV07(BLE).
# `dzbj.py scan` shows a real badge advertises service AF30 (Jieli convention: advertise
# AF30, serve AE30). CoreBluetooth only advertises UUIDs of services we host, so we host
# a token AF30 service purely to get it into the advertisement.
SVC_AF30 = "0000af30-0000-1000-8000-00805f9b34fb"
SVC_AE30 = "0000ae30-0000-1000-8000-00805f9b34fb"
SVC_AE3A = "0000ae3a-0000-1000-8000-00805f9b34fb"
W = GATTCharacteristicProperties.write_without_response | GATTCharacteristicProperties.write
N = GATTCharacteristicProperties.notify
I = GATTCharacteristicProperties.indicate
RW = GATTCharacteristicProperties.read | GATTCharacteristicProperties.write
TABLE = {
    SVC_AF30: {
        "0000af31-0000-1000-8000-00805f9b34fb": RW,
    },
    SVC_AE30: {
        "0000ae01-0000-1000-8000-00805f9b34fb": W,
        "0000ae02-0000-1000-8000-00805f9b34fb": N,
        "0000ae03-0000-1000-8000-00805f9b34fb": W,
        "0000ae04-0000-1000-8000-00805f9b34fb": N,
        "0000ae05-0000-1000-8000-00805f9b34fb": I,
        "0000ae10-0000-1000-8000-00805f9b34fb": RW,
    },
    SVC_AE3A: {
        "0000ae3b-0000-1000-8000-00805f9b34fb": W,
        "0000ae3c-0000-1000-8000-00805f9b34fb": N,
    },
}
PERMS = GATTAttributePermissions.readable | GATTAttributePermissions.writeable


def device_frame(ptype: int, text: bytes) -> bytes:
    """0xA0 | type | 00 | len u16 BE | body | sum-to-zero checksum (layout verified on TV07)."""
    p = bytes([0xA0, ptype, 0]) + len(text).to_bytes(2, "big") + text
    return p + bytes([(256 - sum(p)) & 0xFF])


class FakeBadge:
    def __init__(self, name: str, ack: bool, logpath: str):
        self.name, self.ack = name, ack
        self.log = open(logpath, "a", buffering=1)
        self.server: BlessServer | None = None
        self.t0 = time.time()
        self.count = 0

    def _log(self, line: str):
        stamp = f"{time.time() - self.t0:8.3f}"
        print(f"{stamp} {line}", file=sys.stderr)
        self.log.write(f"{stamp} {line}\n")

    def hello(self, char_uuid: str):
        """Push the type-13 info report on the characteristic that was just subscribed to."""
        info = (b'{"type":13,"allspace":16384,"freespace":8000,"devname":"","size":"368,368",'
                b'"screen":"0","ADD":"79,3F,75,2B,7F,E6","time_mode":1,"brand":0}')
        frame = device_frame(13, info)
        # bless reports subscriptions by short or long UUID depending on backend; normalise.
        full = char_uuid if len(char_uuid) > 8 else f"0000{char_uuid.lower()}-0000-1000-8000-00805f9b34fb"
        for svc, chars in TABLE.items():
            if full in chars:
                ch = self.server.get_characteristic(full)
                if ch is not None:
                    ch.value = bytearray(frame)
                    ok = self.server.update_value(svc, full)
                    self._log(f"HELLO on {full[4:8]} ok={ok} {frame.hex()}")
                return
        self._log(f"HELLO skipped: {char_uuid} not in table")

    def on_read(self, ch: BlessGATTCharacteristic, **_: Any) -> bytearray:
        self._log(f"READ  {ch.uuid[4:8]}")
        return ch.value or bytearray()

    def on_write(self, ch: BlessGATTCharacteristic, value: Any, **_: Any):
        data = bytes(value)
        self.count += 1
        self._log(f"WRITE {ch.uuid[4:8]} #{self.count} len={len(data)} {data.hex()}")
        ch.value = bytearray(data)
        if self.ack and self.server is not None:
            # Answer on AE02 (same service as AE01); the app-facing mode never acked, so
            # whether the sharing badge *needs* this is exactly what --ack is for testing.
            notify_uuid = "0000ae02-0000-1000-8000-00805f9b34fb"
            ackch = self.server.get_characteristic(notify_uuid)
            if ackch is not None:
                ackch.value = bytearray(device_frame(6, b"{GetPacketSuccess}"))
                self.server.update_value(SVC_AE30, notify_uuid)

    async def run(self):
        self.server = BlessServer(name=self.name)
        self.server.read_request_func = self.on_read
        self.server.write_request_func = self.on_write
        for svc, chars in TABLE.items():
            await self.server.add_new_service(svc)
            for uuid, props in chars.items():
                await self.server.add_new_characteristic(svc, uuid, props, None, PERMS)
        await self.server.start()
        self._log(f"advertising as {self.name!r} with services {list(TABLE)}; Ctrl-C to stop")
        # bless has no subscribe callback, but its CoreBluetooth delegate keeps a
        # {central: [char_uuid, ...]} dict. Poll it: the moment a central subscribes, greet it
        # with the info report a real badge pushes on subscribe (observed in app mode on AE3C).
        # A sharing badge shows "sending..." for a beat and then drops us if we stay silent,
        # so this hello is almost certainly what it is waiting for.
        delegate = self.server.peripheral_manager_delegate
        seen: dict[str, list[str]] = {}
        try:
            while True:
                await asyncio.sleep(0.05)
                subs = {k: list(v) for k, v in delegate._central_subscriptions.items()}
                if subs != seen:
                    for central, chars in subs.items():
                        for ch in chars:
                            if ch not in seen.get(central, []):
                                self._log(f"SUBSCRIBE {ch[4:8] if len(ch) > 8 else ch} by {central}")
                                self.hello(ch)
                    for central in seen:
                        if central not in subs:
                            self._log(f"UNSUBSCRIBE/disconnect {central}")
                    seen = subs
        finally:
            await self.server.stop()
            self._log(f"stopped; {self.count} write(s) captured")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="DZBJ-TV07(BLE)", help="advertised local name (default mimics the real badge exactly)")
    ap.add_argument("--ack", action="store_true", help="reply {GetPacketSuccess} on AE02 after every write")
    ap.add_argument("--log", default="capture.log")
    args = ap.parse_args()
    try:
        asyncio.run(FakeBadge(args.name, args.ack, args.log).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
