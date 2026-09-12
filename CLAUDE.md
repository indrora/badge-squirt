# badge-squirt — assistant notes

**Read `STYLE.md` first. It is binding.** Then `doc/dzbj-badge-ble-protocol.md` for the
wire protocol (sections marked verified were observed on real hardware).

Quick map:

* `py_tool/dzbj.py` — reference BLE client (`uv run py_tool/dzbj.py add misc/sniffit.jpg`).
  Hardware-verified: multi-image upload on one connection, flow-controlled writes.
* `py_tool/fakebadge.py` — impersonates a receiving badge (bless). Dead end on macOS; see doc §7.
* `py_tool/gen_fixtures.py` — regenerates `web/test/fixtures/protocol.json`. Run it after any
  change to the Python packer; the TS tests are only as honest as that file.
* `web/` — `npm test` (tsc + node:test), `npm run dev` (build + `serve` on :8080, open
  http://localhost:8080 in Chrome). Web Bluetooth needs a user gesture and localhost/https.

Hardware facts that bit us (details in the doc):

* No `01C0` service on DZBJ-TV07. Write `AE3B` (write-without-response only), notify `AE3C`.
  `AE02` refuses its CCCD write. Resolve by property, always.
* Write-without-response needs host flow control or packets vanish silently.
* The badge never acks. It pushes one type-13 info frame on subscribe and that's it.
* Badge-to-badge share mode is unsolved: receive mode answers bare ASCII `fail` to everything
  tried; the sharing badge never speaks ATT to a Mac. Needs a non-Apple stack or a sniffer.

Running BLE from this assistant: the Claude app has no Bluetooth entitlement, so spawn the
command in Terminal.app via `osascript` with output redirected to the scratchpad, then read
the file. Ask the user to press the badge button first; it advertises only briefly.
