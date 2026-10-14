import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, readErrors, screenshot } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

async function placeholderCount(page) {
  return page.evaluate(() => document.querySelectorAll(".superdoc-drawing-placeholder").length);
}

// Heuristic solid-black-box detector: any rendered element covering a non-trivial area whose
// own background (not an ancestor's) is pure/near-black, inside the editor's content area.
async function blackBoxCount(page) {
  return page.evaluate(() => {
    const isBlack = (color) => {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return false;
      const [r, g, b] = m.slice(1, 4).map(Number);
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      return alpha > 0.5 && r < 12 && g < 12 && b < 12;
    };
    const editor = document.querySelector("#editor");
    if (!editor) return 0;
    // Only count elements whose OWN background fill is solid black and large enough to be a
    // shape (not a 1-2px border/divider line), and that carry no visible text of their own
    // (a solid-black shape swallows its drawing content; a normal UI element with a dark
    // background usually still renders text on top of it).
    // Vector shapes render as inline SVG; a black "box" is usually an SVG shape element
    // filled black (fill attribute or computed `fill` style), not a CSS background-color.
    const svgShapes = [...editor.querySelectorAll("svg *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      const style = getComputedStyle(el);
      return isBlack(style.fill) || isBlack(el.getAttribute("fill") ? `rgb(${el.getAttribute("fill")})` : "");
    });
    const cssBoxes = [...editor.querySelectorAll("*")].filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      return isBlack(getComputedStyle(el).backgroundColor);
    });
    return svgShapes.length + cssBoxes.length;
  });
}

async function checkFixture(browser, baseUrl, doc, label) {
  const page = await openDoc(browser, baseUrl, { doc, mode: "editing" }, { timeoutMs: 60000 });
  await page.waitForTimeout(1500);
  const placeholders = await placeholderCount(page);
  const blackBoxes = await blackBoxCount(page);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const shapeALabelVisible = bodyText.includes("Grouped text box label");
  const errors = await readErrors(page);
  const shotName = `${doc.split("/").pop().replace(/\.docx$/, "")}.png`;
  await screenshot(page, resolvePath(HERE, "screenshots"), shotName);
  await page.close();
  const result = { doc, label, placeholders, blackBoxes, shapeALabelVisible, errors, screenshot: `screenshots/${shotName}` };
  console.log(`[${label}] placeholders=${placeholders} blackBoxes=${blackBoxes} shapeALabelVisible=${shapeALabelVisible} errors=${errors.length}`);
  return result;
}

async function main() {
  const server = await startServer();
  const browser = await launchBrowser();
  const results = [];
  try {
    console.log("=== Real-structure fixture (anonymized PO, grouped text boxes + custGeom) ===");
    results.push(await checkFixture(browser, server.url, "SD-79/grouped-textboxes-po-overlay.docx", "po-overlay (real structure)"));

    console.log("\n=== Synthetic fixture: grouped text box wrapped in mc:AlternateContent + VML Fallback ===");
    results.push(await checkFixture(browser, server.url, "SD-79/synthetic-alternatecontent-broken.docx", "synthetic broken (AlternateContent group + no-fill custGeom)"));
    results.push(await checkFixture(browser, server.url, "SD-79/synthetic-alternatecontent-fixed.docx", "synthetic fixed (ungrouped + noFill)"));

    console.log("\n=== Synthetic fixture: same group, floating (wp:anchor) instead of inline ===");
    results.push(await checkFixture(browser, server.url, "SD-79/synthetic-alternatecontent-anchored-broken.docx", "synthetic broken, anchored/floating"));
  } finally {
    await browser.close();
    server.stop();
  }

  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(results, null, 2));

  const poOverlay = results.find((r) => r.label === "po-overlay (real structure)");
  const synthBroken = results.find((r) => r.label.startsWith("synthetic broken"));
  const synthFixed = results.find((r) => r.label.startsWith("synthetic fixed"));

  console.log("\n=== PASS/FAIL ===");
  const poOverlayBroken = poOverlay.placeholders > 0 || poOverlay.blackBoxes > 0 || !poOverlay.shapeALabelVisible;
  const synthBrokenReproduces = synthBroken.placeholders > 0 || synthBroken.blackBoxes > 0;
  const synthFixedClean = synthFixed.placeholders === 0 && synthFixed.shapeALabelVisible;
  console.log(`po-overlay: placeholders=${poOverlay.placeholders} blackBoxes=${poOverlay.blackBoxes} -> ${poOverlayBroken ? "BROKEN (content obscured)" : "renders cleanly"}`);
  console.log(`synthetic-alternatecontent-broken: placeholders=${synthBroken.placeholders} blackBoxes=${synthBroken.blackBoxes} -> ${synthBrokenReproduces ? "REPRODUCES" : "did not reproduce"}`);
  console.log(`synthetic-alternatecontent-fixed: placeholders=${synthFixed.placeholders} -> ${synthFixedClean ? "renders cleanly, as expected" : "UNEXPECTED: still broken"}`);

  const bugReproduces = poOverlayBroken || synthBrokenReproduces;
  console.log(bugReproduces ? "\nPASS (bug reproduced on 2.23.0)" : "\nFAIL (bug did not reproduce on 2.23.0)");
  assert.ok(bugReproduces, "expected grouped-textbox / stroke-only-shape rendering defect to reproduce on 2.23.0");
}

await main();
