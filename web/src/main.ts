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
import { neededKb, type PreparedImage } from "./image.js";

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

// The badge's reported size drives the canvas. Free space is deliberately NOT pushed into
// the picker: it changes after every upload, and any attribute change there used to
// trigger a re-encode and a layout shift. The connection panel owns that status.
badge.on("info", (e) => picker.setAttribute("size", e.detail.size));

picker.addEventListener("image", (e) => {
  const img = (e as CustomEvent<PreparedImage>).detail;
  upload.setImage(img);
  connect.setImageKb(neededKb(img.jpeg.length));
});
connect.addEventListener("connection", () => upload.refresh());

// After a send the badge has ~this much less free space; it never re-reports.
upload.addEventListener("uploaded", () => {
  if (badge.info && picker.image) {
    badge.info.freespace -= neededKb(picker.image.jpeg.length);
    connect.setImageKb(neededKb(picker.image.jpeg.length));
  }
});
