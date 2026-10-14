import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(LIB_DIR, "../..");
const TIMING_PROBE_SCRIPT = readFileSync(resolvePath(LIB_DIR, "timing-probe.js"), "utf8");

function resolveViteUrl(chunk, resolve) {
  const match = String(chunk)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .match(/Local:\s+(http:\/\/\S+)/);
  if (match) resolve(match[1].replace(/\/$/, ""));
}

export async function startServer() {
  const viteBin = resolvePath(REPO_ROOT, "node_modules/vite/bin/vite.js");
  const vite = spawn("node", [viteBin, "--config", resolvePath(REPO_ROOT, "vite.config.mjs"), "--port", "0"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  const url = await new Promise((resolve, reject) => {
    vite.stdout.on("data", (chunk) => resolveViteUrl(chunk, resolve));
    vite.once("exit", (code) => reject(new Error(`vite exited before printing a URL (code ${code})`)));
  });
  return { url, stop: () => vite.kill() };
}

export async function launchBrowser() {
  return chromium.launch({ headless: process.env.HEADFUL !== "1" });
}

export async function openDoc(browser, baseUrl, queryParams = {}, options = {}) {
  const { viewport = { width: 1280, height: 900 }, timeoutMs = 60000 } = options;
  const page = await browser.newPage({ viewport });
  const search = new URLSearchParams(queryParams).toString();
  await page.goto(`${baseUrl}/harness/index.html${search ? `?${search}` : ""}`);
  await page.bringToFront();
  const timedOut = Symbol("timedOut");
  const result = await Promise.race([
    page.evaluate(() => window.__ready.then(() => true)),
    page.waitForTimeout(timeoutMs).then(() => timedOut),
  ]);
  if (result === timedOut) throw new Error(`window.__ready did not resolve within ${timeoutMs}ms`);
  return page;
}

export function readErrors(page) {
  return page.evaluate(() => window.__errors);
}

export async function screenshot(page, outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const path = resolvePath(outDir, name);
  await page.screenshot({ path });
  return path;
}

export async function installTimingObservers(page) {
  await page.evaluate(TIMING_PROBE_SCRIPT);
}

export function readTiming(page) {
  return page.evaluate(() => window.__timing);
}

export async function jsHeapMB(page) {
  const client = await page.context().newCDPSession(page);
  const { usedSize } = await client.send("Runtime.getHeapUsage");
  await client.detach();
  return usedSize / 1024 / 1024;
}

export function evalSd(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

function readDocPath({ path, args }) {
  const segments = path.split(".");
  const method = segments.pop();
  const target = segments.reduce((object, key) => object[key], window.__sd.activeEditor.doc);
  return target[method](...args);
}

export function callDoc(page, path, ...args) {
  return page.evaluate(readDocPath, { path, args });
}

async function encodeExportedDocx(exportOptions) {
  const blob = await window.__sd.export({ exportType: ["docx"], triggerDownload: false, ...exportOptions });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export async function exportDocx(page, exportOptions = {}) {
  const base64 = await page.evaluate(encodeExportedDocx, exportOptions);
  return Buffer.from(base64, "base64");
}
