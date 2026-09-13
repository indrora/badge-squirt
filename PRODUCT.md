# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hobbyist owners of the "DZBJ-" round BLE picture badge (sold with the e-Goods Android
app), at a laptop running Chrome or Edge, or on an Android phone in Chrome, wanting a
picture (or a short animation) on the badge in under a minute without installing the
vendor app or creating an account.
Technical-ish, occasional use: a session is "pick, frame, send", then walk away.

## Product Purpose

badge squirt pushes still images and small animations to the badge over Web Bluetooth
from a static web page (https://indrora.github.io/badge-squirt/). It exists because the
vendor app is poor (squashes images, phones home) and the protocol turned out to be
recoverable. Success: the picture the user framed on screen is what the badge shows,
first try, with no surprise about size or quality.

## Positioning

The only uploader for this badge that runs in a browser: no install, no account, no
telemetry (the vendor app POSTs device IDs to a plain-HTTP endpoint on first connect).
Reverse-engineered from the APK and hardware-verified on a real DZBJ-TV07. Open source.
No claim of superiority beyond that; it is a community tool that works.

## Operating Context

* The badge advertises only briefly after a physical button press; the user must press
  the badge, then click Connect within seconds. Chrome shows its own device chooser.
* The panel is round, 368×368 (the badge reports its size on connect; honour it).
* Uploads take about a second per still at q0.7. The badge shows "Updating…" and renders
  on its own; it never acknowledges packets, so the app cannot confirm success.
* Free space is reported once per connection (KB); the app must track its own estimate.
* A companion Python CLI (`py_tool/dzbj.py`) is the reference implementation and the
  place where protocol experiments happen; the web app follows it, never leads it.

## Capabilities and Constraints

* Confirmed: connect/disconnect; a list of pictures; per-picture pan/zoom crop and JPEG
  quality with the encoded result shown; GIFs decode into multi-frame entries; upload each
  entry individually (still → type 6, GIF → type 5 at native speed) or flatten 2–5
  entries into one animation at a chosen frame time (0.5–10 s); free-space check with
  override; raw hex debug log.
* Chrome/Edge only (Web Bluetooth, ImageDecoder). Must be served over https or localhost.
* No bundler: TypeScript compiled by tsc to browser ES modules; UI kit is Oat (@knadh/oat)
  as an npm dependency. Deployed to GitHub Pages on `release-YYYY.n` tags.
* Badge-to-badge share mode is not supported (protocol unsolved; see doc §7).
* Phones: Android Chrome is a confirmed target (verified working 2026-09-13); the page must
  fit a 375 px portrait viewport with the send bar within thumb reach. iOS is not a target
  (no Web Bluetooth in Safari or iOS Chrome).

## Brand Commitments

Name: "badge squirt", lowercase. Voice: plain, direct, a little irreverent; no marketing
tone. Repo: github.com/indrora/badge-squirt. No logo or brand assets exist.

## Evidence on Hand

* Protocol document with hardware-verified sections: `doc/dzbj-badge-ble-protocol.md`.
* Sample photos and GIFs that have been sent to a real badge: `misc/`.
* A photo of the badge showing an uploaded image exists in the project conversation, not
  in the repo. No testimonials, user counts, or press; do not invent any.

## Product Principles

1. What you see is what the badge gets: the preview is the encoded bytes, not the source.
2. Never make the user guess at hardware state; surface size, free space, pacing, and the
   press-then-connect ritual explicitly.
3. Hardware truth over vendor truth: the app mirrors what the badge actually does, and the
   debug log exists so disagreements are settled in hex.
4. One page, no ceremony: no accounts, no wizards, no telemetry, nothing to install.
5. Fail loudly and specifically; the badge is silent, so the app must not be.

## Accessibility & Inclusion

No product-specific requirement established. Standard keyboard operability and live
regions for status text are expected; the drag-to-pan editor needs slider equivalents
(present: zoom slider, reset).
