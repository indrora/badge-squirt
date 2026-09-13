/**
 * main.ts — wires one Badge session and one ImageStore to the components. No framework,
 * no bundler: index.html loads this as an ES module from dist/, and every import ends in
 * ".js" because the browser, not a bundler, resolves them.
 *
 * Layout is the device-and-queue workbench from doc/shape-workbench.md: the hardware rail
 * (<badge-connect>, <space-gauge>, <image-list>), the stage (<image-picker>), the action
 * bar (<upload-progress>) and the debug drawer (<debug-log>).
 */

import { Badge } from "./ble/badge.js";
import { ImageStore } from "./model.js";
import "./components/badge-connect.js";
import "./components/space-gauge.js";
import "./components/image-list.js";
import "./components/image-picker.js";
import "./components/upload-progress.js";
import "./components/debug-log.js";
import type { BadgeConnect } from "./components/badge-connect.js";
import type { SpaceGauge } from "./components/space-gauge.js";
import type { ImageList } from "./components/image-list.js";
import type { ImagePicker } from "./components/image-picker.js";
import type { UploadProgress } from "./components/upload-progress.js";
import type { DebugLog } from "./components/debug-log.js";
import { neededKb } from "./image.js";
import { fromHex, parseNotification } from "./protocol/packet.js";
import type { ImageEntry } from "./model.js";

const badge = new Badge();
const store = new ImageStore();

const connect = document.querySelector<BadgeConnect>("badge-connect")!;
const gauge = document.querySelector<SpaceGauge>("space-gauge")!;
const list = document.querySelector<ImageList>("image-list")!;
const picker = document.querySelector<ImagePicker>("image-picker")!;
const upload = document.querySelector<UploadProgress>("upload-progress")!;
const debug = document.querySelector<DebugLog>("debug-log")!;

// Debugging handle: lets a devtools user (or a test) poke the session, e.g. inspect
// badge.info or store.entries, without reaching into module scope.
(globalThis as unknown as { badgeSquirt: unknown }).badgeSquirt = { badge, store };

connect.attach(badge);
gauge.attach(badge, store);
list.attach(store);
picker.attach(store);
upload.attach(badge, store);
debug.attach(badge);

if (!Badge.supported) {
  debug.add("Web Bluetooth unavailable: use Chrome or Edge, over https:// or http://localhost");
  document.querySelector(".unsupported")!.removeAttribute("hidden");
}

// The badge's reported size drives the canvas and first encodes. Free space is never pushed
// into the picker (it used to trigger re-encodes); <space-gauge> owns it.
badge.on("info", (e) => {
  picker.setAttribute("size", e.detail.size);
  const { width, height } = badge.size;
  list.setSize(width, height);
});
connect.addEventListener("connection", (e) => {
  upload.refresh();
  picker.setAttribute("connected", String((e as CustomEvent<boolean>).detail)); // drives the empty ring's steps
});
// The free-space override is a gauge control; the bar only reads it.
gauge.addEventListener("override-change", (e) => upload.setOverride((e as CustomEvent<boolean>).detail));

// After a send the badge has that much less free space; it never re-reports. The store has
// already marked the entries sent, so the gauge moves their KB from queued to used.
upload.addEventListener("uploaded", (e) => {
  picker.ping(); // the ring acknowledges: the pictures left the laptop
  if (!badge.info) return;
  const sent = (e as CustomEvent<ImageEntry[]>).detail;
  badge.info.freespace -= sent.reduce((n, entry) => n + neededKb(entry.prepared!.bytes), 0);
  gauge.render();
});

// Debug drawer: closed by default, opens only by hand, remembers its state per browser.
const drawer = document.querySelector<HTMLDetailsElement>("details.drawer")!;
try {
  drawer.open = localStorage.getItem("badge-squirt.drawer") === "open";
} catch {
  /* storage unavailable: stays closed */
}
drawer.addEventListener("toggle", () => {
  try {
    localStorage.setItem("badge-squirt.drawer", drawer.open ? "open" : "closed");
  } catch {
    /* ignore */
  }
});

// `?demo`: load the sample pictures that `npm run demo-assets` copies under web/ and fake a
// connected badge, so screenshots and finish reviews see the populated workbench without
// hardware. Never on the deployed site: the files are not shipped and the flag is inert.
if (location.search.includes("demo")) {
  document.documentElement.dataset["demo"] = "1"; // components label the fake state
  void (async () => {
    Object.defineProperty(badge, "connected", { get: () => true });
    badge.info = { type: 13, size: "368,368", freespace: 5124, allspace: 16384, time_mode: 1, ADD: "79,3F,75,2B,7F,E6" };
    (badge as unknown as { device: unknown }).device = { name: "DZBJ-TV07(BLE)" };
    badge.dispatchEvent(new CustomEvent("info", { detail: badge.info }));
    (connect as unknown as { setState(c: boolean): void }).setState(true); // what a real connect() does
    // Give the drawer something true to show: the info frame a DZBJ-TV07 really sent (doc §4).
    debug.add("demo mode: no hardware; the frame below is a real capture from 2026-09-12");
    const raw = fromHex(
      "a00d00008a7b2274797065223a31332c22616c6c7370616365223a31363338342c22667265657370616365223a353530302c226465766e616d65223a22222c2273697a65223a223336382c333638222c2273637265656e223a2230222c22414444223a2237392c33462c37352c32422c37462c4536222c2274696d655f6d6f6465223a312c226272616e64223a307dd0",
    );
    badge.dispatchEvent(new CustomEvent("frame", { detail: { raw, parsed: parseNotification(raw) } }));
    for (const [name, type] of [["_test.jpg", "image/jpeg"], ["_test2.jpg", "image/jpeg"], ["_test.gif", "image/gif"]] as const) {
      const r = await fetch(name);
      if (r.ok) await store.add(new File([await r.blob()], name.replace("_test", "photo"), { type }), 368, 368);
    }
    if (store.entries[0]) store.markSent([store.entries[0]]);
    upload.refresh();
    document.documentElement.dataset["demoReady"] = "1";
  })();
}

// The Pages workflow drops the release tag into VERSION next to index.html; locally there
// is no such file, so skip the request (and its console 404) and leave the footer blank.
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
  fetch("VERSION")
  .then((r) => (r.ok ? r.text() : ""))
  .then((v) => (document.querySelector(".version")!.textContent = v.trim()))
  .catch(() => undefined);
