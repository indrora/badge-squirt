/**
 * main.ts — wires one Badge session and one ImageStore to the components. No framework,
 * no bundler: index.html loads this as an ES module from dist/, and every import ends in
 * ".js" because the browser, not a bundler, resolves them.
 */

import { Badge } from "./ble/badge.js";
import { ImageStore } from "./model.js";
import "./components/badge-connect.js";
import "./components/image-list.js";
import "./components/image-picker.js";
import "./components/upload-progress.js";
import "./components/debug-log.js";
import type { BadgeConnect } from "./components/badge-connect.js";
import type { ImageList } from "./components/image-list.js";
import type { ImagePicker } from "./components/image-picker.js";
import type { UploadProgress } from "./components/upload-progress.js";
import type { DebugLog } from "./components/debug-log.js";
import { neededKb } from "./image.js";

const badge = new Badge();
const store = new ImageStore();

const connect = document.querySelector<BadgeConnect>("badge-connect")!;
const list = document.querySelector<ImageList>("image-list")!;
const picker = document.querySelector<ImagePicker>("image-picker")!;
const upload = document.querySelector<UploadProgress>("upload-progress")!;
const debug = document.querySelector<DebugLog>("debug-log")!;

connect.attach(badge);
list.attach(store);
picker.attach(store);
upload.attach(badge, store);
debug.attach(badge);

if (!Badge.supported) {
  debug.add("Web Bluetooth unavailable: use Chrome or Edge, over https:// or http://localhost");
  document.querySelector(".unsupported")!.removeAttribute("hidden");
}

// The badge's reported size drives the canvas and first encodes. Free space is
// deliberately NOT pushed into the picker: it changes after every upload, and any
// attribute change there used to trigger a re-encode and a layout shift. The connection
// panel owns that status; it shows the total of everything in the list.
badge.on("info", (e) => {
  picker.setAttribute("size", e.detail.size);
  const { width, height } = badge.size;
  list.setSize(width, height);
  connect.setImageKb(totalKb());
});

const totalKb = () => store.ready.reduce((n, e) => n + neededKb(e.prepared!.jpeg.length), 0);
store.on("update", () => connect.setImageKb(totalKb()));
store.on("change", () => connect.setImageKb(totalKb()));
connect.addEventListener("connection", () => upload.refresh());

// After a send the badge has ~this much less free space; it never re-reports.
upload.addEventListener("uploaded", () => {
  if (badge.info) {
    badge.info.freespace -= totalKb();
    connect.setImageKb(totalKb());
  }
});

// The Pages workflow drops the release tag into VERSION next to index.html; locally there
// is no such file and the footer just stays blank.
fetch("VERSION")
  .then((r) => (r.ok ? r.text() : ""))
  .then((v) => (document.querySelector(".version")!.textContent = v.trim()))
  .catch(() => undefined);
