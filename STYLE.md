# badge-squirt style guide

Read this before touching anything. Other assistants: this file is binding, and
`CLAUDE.md` points you here for a reason.

## What this repo is

Tooling for the "DZBJ-" round BLE picture badge, reverse-engineered from the e-Goods APK
(vendor bundle in `_apk/`, ignored by git). The authoritative wire protocol is
`doc/dzbj-badge-ble-protocol.md`. **Everything in it marked "verified" was observed on a
real DZBJ-TV07; everything else is what the vendor JS does.** When code and doc disagree,
fix the doc in the same change.

```
py_tool/   Python (uv scripts, bleak/bless/rich). dzbj.py is the reference client.
web/       Web Bluetooth uploader: TypeScript, Web Components, tsc only, no bundler.
doc/       Protocol doc and the original brief.
misc/      Sample photos and captured device output used in testing.
```

## Ground rules for every language

* **Comment the why, at length.** Non-trivial code carries a real paragraph: what the
  badge actually does, which experiment proved it, what breaks if you change it. The
  flow-control comment in `py_tool/dzbj.py::Badge.write` is the model. A future reader
  has no badge in hand; the comments are their only oscilloscope.
* **Descriptive names.** No 1–2 letter identifiers outside a tight loop index or a
  DataView alias inside a five-line function.
* **Use the library.** stdlib first (`struct`, `DataView`, `node:test`), then the
  mature standard for the job (bleak, bless, rich, `@types/web-bluetooth`). Do not write
  a hex helper if the language has one; do not write a progress bar.
* **Hardware truth over vendor truth.** Resolve BLE characteristics by property, never by
  hard-coded UUID. Never wait for an ack the doc says was not observed.
* **Keep the pure layer pure.** Packing/framing code must not touch BLE, DOM, files or
  time. It is tested against fixtures generated from `py_tool/gen_fixtures.py`; if you
  change the Python packer, regenerate `web/test/fixtures/protocol.json` in the same
  commit and never hand-edit it.

## Python (`py_tool/`)

* Black/PEP 8, line length 110 (the protocol comments need the room). `from __future__
  import annotations`, type hints on every signature.
* uv "script" headers (`# /// script`) declare deps; no requirements files.
* Human chatter goes to **stderr** through the shared `rich` `Console`; stdout is for
  machine-readable output only (JSON, hex) so commands can be piped.
* Every subcommand is `cmd_<name>(args)` with a docstring saying what badge mode it is
  for and what has been observed. Add the usage line to the module docstring.
* BLE actions from Claude: the Claude app has no Bluetooth entitlement, so run scripts via
  `osascript` → Terminal.app and read a log file (see memory / doc §7 notes).

## TypeScript (`web/`)

* `tsc` is the whole toolchain. Browser-resolved ES modules: **every relative import ends
  in `.js`**, even from `.ts` sources. `strict` plus `noUncheckedIndexedAccess`; use `!`
  only immediately after a `querySelector` for markup this same file wrote.
* One custom element per file under `src/components/`, class name in PascalCase, tag in
  kebab-case, registered at the bottom of its own file. Elements render their own markup
  in `connectedCallback`, receive the shared `Badge` through `attach()`, and talk
  outward only through bubbling `CustomEvent`s. No element reaches into another.
* `src/protocol/` is byte-in/byte-out and has no DOM types in its imports.
* Tests: `node:test` + `node:assert/strict`, compiled by the same tsconfig into
  `dist/test/`. Table-drive from the fixture file; a hand-written assertion is for a
  property (checksum sums to zero, countdown reaches zero), not a re-derived byte string.
* Formatting: 2-space indent, double quotes, trailing commas, ~130 columns. Prefer
  early returns and small functions over nesting.

## Git

* Commit format: `<type>: <summary>` then a blank line and a paragraph of *why*. Types
  seen here: `fix`, `feature`, `ui`, `chore`, `doc`.
* Never commit `_apk/`, the APK, `node_modules/`, or `web/dist/`.
* Claude commits only with the user's explicit approval of the exact message.
