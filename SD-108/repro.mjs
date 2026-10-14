// SD-108: a full-page header image (behindDoc, wrapNone, extent = the whole A4 page) is
// drawn shrunk to the body height between the top and bottom margins, then centred.
// Prints PASS when the rendered image is smaller than its declared wp:extent.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { startServer, launchBrowser, openDoc, screenshot } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "SD-108/page-art-shrunk.docx";
const EMU_PER_PX = 9525;
const TWIPS_PER_PX = 15;

async function readDeclaredGeometry() {
  const zip = await JSZip.loadAsync(readFileSync(resolvePath(HERE, "page-art-shrunk.docx")));
  const header = await zip.file("word/header1.xml").async("string");
  const documentXml = await zip.file("word/document.xml").async("string");
  const [, extentWidth, extentHeight] = header.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  const [, pageHeight] = documentXml.match(/<w:pgSz w:w="\d+" w:h="(\d+)"/);
  const [, marginTop, marginBottom] = documentXml.match(/<w:pgMar w:top="(\d+)" w:right="\d+" w:bottom="(\d+)"/);
  return {
    imageWidthPx: Math.round(extentWidth / EMU_PER_PX),
    imageHeightPx: Math.round(extentHeight / EMU_PER_PX),
    bodyHeightPx: Math.round((pageHeight - marginTop - marginBottom) / TWIPS_PER_PX),
  };
}

async function measureRendered(page) {
  return page.evaluate(() => {
    const pageElement = document.querySelector(".superdoc-page");
    const images = [...pageElement.querySelectorAll(".superdoc-image-fragment")];
    const largest = images.sort((first, second) => second.offsetHeight - first.offsetHeight)[0];
    const pageRect = pageElement.getBoundingClientRect();
    const imageRect = largest.getBoundingClientRect();
    return {
      page: { width: Math.round(pageRect.width), height: Math.round(pageRect.height) },
      image: {
        left: Math.round(imageRect.left - pageRect.left),
        top: Math.round(imageRect.top - pageRect.top),
        width: Math.round(imageRect.width),
        height: Math.round(imageRect.height),
      },
    };
  });
}

async function run() {
  const declared = await readDeclaredGeometry();
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" }, { viewport: { width: 900, height: 1200 } });
  await page.waitForTimeout(1500);
  const rendered = await measureRendered(page);
  await screenshot(page, resolvePath(HERE, "screenshots"), "superdoc-2.23.0.png");
  await browser.close();
  server.stop();

  const shrunk = rendered.image.height < declared.imageHeightPx * 0.9;
  const result = { version: "2.23.0", fixture: FIXTURE_REPO_PATH, declared, rendered, shrunk };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(shrunk ? "PASS (bug reproduced): page-art image is drawn smaller than its declared extent" : "FAIL (not reproduced)");
}

await run();
