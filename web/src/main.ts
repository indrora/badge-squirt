/**
 * main.ts — wires one Badge session to the four components. No framework, no bundler:
 * index.html loads this as an ES module from dist/, and every import ends in ".js"
 * because the browser, not a bundler, resolves them.
 */

import { Badge } from "./ble/badge.js";
import "./components/badge-connect.js";
import "./components/image-picker.js";
import "./components/upload-progress.js";
import "./components/debug-log.js";
import type { BadgeConnect } from "./components/badge-connect.js";
import type { ImagePicker } from "./components/image-picker.js";
import type { UploadProgress } from "./components/upload-progress.js";
import type { DebugLog } from "./components/debug-log.js";
import type { PreparedImage } from "./image.js";

const badge = new Badge();

const connect = document.querySelector<BadgeConnect>("badge-connect")!;
const picker = document.querySelector<ImagePicker>("image-picker")!;
const upload = document.querySelector<UploadProgress>("upload-progress")!;
const debug = document.querySelector<DebugLog>("debug-log")!;

connect.attach(badge);
upload.attach(badge);
debug.attach(badge);

if (!Badge.supported) {
  debug.add("Web Bluetooth unavailable: use Chrome or Edge, over https:// or http://localhost");
  document.querySelector(".unsupported")!.removeAttribute("hidden");
}

// The badge's reported size drives the canvas; free space drives the readout colour.
badge.on("info", (e) => {
  picker.setAttribute("size", e.detail.size);
  picker.setAttribute("free", String(e.detail.freespace));
});
badge.on("disconnected", () => picker.removeAttribute("free"));

picker.addEventListener("image", (e) => upload.setImage((e as CustomEvent<PreparedImage>).detail));
connect.addEventListener("connection", () => upload.refresh());

// After a send the badge has ~this much less free space; it never re-reports.
upload.addEventListener("uploaded", () => {
  if (badge.info && picker.image) {
    badge.info.freespace -= Math.ceil((picker.image.jpeg.length + 36) / 1024);
    picker.setAttribute("free", String(badge.info.freespace));
  }
});
