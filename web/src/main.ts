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
connect.addEventListener("connection", () => upload.refresh());

// After a send the badge has that much less free space; it never re-reports. The store has
// already marked the entries sent, so the gauge moves their KB from queued to used.
upload.addEventListener("uploaded", (e) => {
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
// is no such file and the footer just stays blank.
fetch("VERSION")
  .then((r) => (r.ok ? r.text() : ""))
  .then((v) => (document.querySelector(".version")!.textContent = v.trim()))
  .catch(() => undefined);
