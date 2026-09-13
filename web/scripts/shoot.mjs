// shoot.mjs — capture the ?demo workbench at the review viewports using the installed
// Edge/Chrome via puppeteer-core (no browser download). Waits for main.ts to flag
// html[data-demo-ready], which is set only after every sample picture has encoded, so a
// capture never shows a half-loaded state. Usage: node scripts/shoot.mjs [outDir] [url]
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";

const out = process.argv[2] ?? "../.impeccable/review";
const url = process.argv[3] ?? "http://localhost:8080/?demo";
const candidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const executablePath = candidates.find(existsSync);
if (!executablePath) throw new Error("no Chrome/Edge found");
mkdirSync(out, { recursive: true });

const shots = [
  { name: "desktop", width: 1100, height: 860, fullPage: false },
  { name: "mobile", width: 375, height: 812, fullPage: true },
  { name: "user-800", width: 800, height: 1000, fullPage: true },
];
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector("html[data-demo-ready]", { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 400)); // let the encoded preview paint
    await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: s.fullPage });
    console.log(`${s.name}: ${s.width}x${s.height}${s.fullPage ? " full page" : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
