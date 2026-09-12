#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22", "pillow>=10", "rich>=13"]
# ///
"""
gen_fixtures.py — dump protocol test vectors from the (hardware-verified) Python packer
into web/test/fixtures/protocol.json so the TypeScript packet layer is tested against the
exact bytes that have been seen to work on a real badge, not against a re-derivation.

  uv run py_tool/gen_fixtures.py            # writes web/test/fixtures/protocol.json

Inputs are deterministic (a counter-pattern "blob" rather than a real JPEG) so the file
is stable across runs and small enough to read in a diff. The badge doesn't care what the
JPEG bytes are for framing purposes; what matters is header layout, fragment countdown,
checksum, and the IMB / frame-pack containers.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("dzbj", HERE / "dzbj.py")
dzbj = importlib.util.module_from_spec(spec)
sys.argv = ["dzbj"]          # dzbj.py builds an argparse parser only under __main__, but be safe
spec.loader.exec_module(dzbj)


framepack = dzbj.framepack   # the real packer, now that dzbj.py has one


def pattern(n: int, seed: int = 0) -> bytes:
    return bytes((seed + i) & 0xFF for i in range(n))


blob_small = pattern(100)               # fits in one chunk with the envelope
blob_multi = pattern(1200, 7)           # 1200 + 18 envelope bytes -> 3 chunks of 496
fake_jpeg = b"\xff\xd8" + pattern(60, 3) + b"\xff\xd9"

# The single info frame captured from DZBJ-TV07 on 2026-09-12 (see protocol doc §4).
info_frame = bytes.fromhex(
    "a00d00008a7b2274797065223a31332c22616c6c7370616365223a31363338342c226672656573706163"
    "65223a353530302c226465766e616d65223a22222c2273697a65223a223336382c333638222c22736372"
    "65656e223a2230222c22414444223a2237392c33462c37352c32422c37462c4536222c2274696d655f6d"
    "6f6465223a312c226272616e64223a307dd0"
)
hdr, text = dzbj.parse_notification(info_frame)

fixtures = {
    "_generated_by": "py_tool/gen_fixtures.py — do not edit by hand",
    "constants": {
        "HEAD_APP_TO_DEVICE": dzbj.HEAD_APP_TO_DEVICE,
        "HEAD_DEVICE_TO_APP": dzbj.HEAD_DEVICE_TO_APP,
        "ALBUM_CHUNK": dzbj.ALBUM_CHUNK,
        "DYNAMIC_CHUNK": dzbj.DYNAMIC_CHUNK,
        "TYPE": dzbj.TYPE,
    },
    "packet": [
        {"name": "version query", "type": 7, "payload_hex": b'{"type":7}'.hex(), "total": 0, "remaining": 0,
         "expected_hex": dzbj.pack_json(7, {"type": 7}).hex()},
        {"name": "empty payload", "type": 6, "payload_hex": "", "total": 0, "remaining": 0,
         "expected_hex": dzbj.packet(6, b"").hex()},
        {"name": "fragment header fields", "type": 6, "payload_hex": pattern(5).hex(), "total": 300, "remaining": 299,
         "expected_hex": dzbj.packet(6, pattern(5), 300, 299).hex()},
        {"name": "checksum wraps", "type": 6, "payload_hex": (b"\xff" * 10).hex(), "total": 0, "remaining": 0,
         "expected_hex": dzbj.packet(6, b"\xff" * 10).hex()},
    ],
    "fragment": [
        {"name": "single chunk", "type": 6, "blob_hex": blob_small.hex(), "chunk": 496,
         "expected_hex": [p.hex() for p in dzbj.fragment_image(6, blob_small, 496)]},
        {"name": "three chunks countdown", "type": 6, "blob_hex": blob_multi.hex(), "chunk": 496,
         "expected_hex": [p.hex() for p in dzbj.fragment_image(6, blob_multi, 496)]},
        {"name": "type 5 keeps type-6 envelope", "type": 5, "blob_hex": blob_multi.hex(), "chunk": 426,
         "expected_hex": [p.hex() for p in dzbj.fragment_image(5, blob_multi, 426)]},
    ],
    "imb": [
        {"name": "368x368", "jpeg_hex": fake_jpeg.hex(), "width": 368, "height": 368,
         "expected_hex": dzbj.imb_container(fake_jpeg, 368, 368).hex()},
        {"name": "non-square", "jpeg_hex": fake_jpeg.hex(), "width": 240, "height": 296,
         "expected_hex": dzbj.imb_container(fake_jpeg, 240, 296).hex()},
    ],
    "framepack": [
        {"name": "two frames 100ms", "jpegs_hex": [fake_jpeg.hex(), pattern(33, 9).hex()], "width": 368,
         "height": 368, "interval_ms": 100,
         "expected_hex": framepack([fake_jpeg, pattern(33, 9)], 368, 368, 100).hex()},
    ],
    "notification": [
        {"name": "info report from DZBJ-TV07", "raw_hex": info_frame.hex(), "header_hex": hdr.hex(),
         "text": text, "json": json.loads(text)},
        {"name": "packet success", "raw_hex": "a006000012" + b"{GetPacketSuccess}".hex() + "00",
         "header_hex": "a006000012", "text": "{GetPacketSuccess}", "json": None},
        {"name": "bare fail (receive mode)", "raw_hex": b"fail".hex(), "header_hex": b"fail".hex(),
         "text": "", "json": None},
    ],
}

out = HERE.parent / "web" / "test" / "fixtures" / "protocol.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(fixtures, indent=2) + "\n")
print(f"wrote {out} ({out.stat().st_size} bytes)")
