// SD-83: document-wide geometry -- off-screen content can't be measured,
// decorated, or observed through the public `ui.viewport` surface
// (window.__ui, i.e. createSuperDocUI()).
//
// Confirms, on superdoc@2.23.0:
//  1. ui.viewport.getRect() resolves real geometry for a MOUNTED text range.
//  2. The same call for a text range far outside the virtualized/painted window
//     (a 200-page document, scrolled to the top) fails closed instead of
//     measuring it -- the core "off-screen content can't be measured" gap.
//  3. ui.viewport.getRect() rejects a tracked-change/comment ENTITY address with
//     "invalid-target" even though the public .d.ts (ViewportGetRectTarget /
//     EntityAddress) declares entity addresses as a valid target shape --
//     getRect-by-entity-id is declared but not actually wired at runtime.
//     ui.viewport.scrollIntoView() and ui.trackChanges.scrollTo(id), by
//     contrast, DO accept and honor the same entity address / id.
//  4. A hand-added DOM attribute on a painted tracked-change mark does not
//     survive the next painter pass.
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LARGE_FIXTURE = "_fixtures/msa-200-pages-template.docx";
const TRACKED_FIXTURE = "_fixtures/dpa-multi-redline.docx";

async function checkVirtualization(page) {
  return evalSd(page, async () => {
    const blocks = await window.__sd.activeEditor.doc.blocks.list({ includeText: true });
    const nearTop = blocks.blocks.find((block) => (block.text ?? "").length > 5);
    const nearEnd = [...blocks.blocks].reverse().find((block) => (block.text ?? "").length > 5);
    const textTarget = (blockId) => ({ kind: "text", blockId, range: { start: 0, end: 3 } });
    return {
      totalBlocks: blocks.total ?? blocks.blocks.length,
      nearTopRect: window.__ui.viewport.getRect({ target: textTarget(nearTop.nodeId) }),
      nearEndRect: window.__ui.viewport.getRect({ target: textTarget(nearEnd.nodeId) }),
    };
  });
}

async function checkEntityGetRectVsScrollIntoView(page) {
  return evalSd(page, async () => {
    const list = await window.__sd.activeEditor.doc.trackChanges.list();
    const first = list.items[0];
    return {
      totalChanges: list.total,
      getRectByEntityAddress: window.__ui.viewport.getRect({ target: first.address }),
      scrollIntoViewByEntityAddress: await window.__ui.viewport.scrollIntoView({ target: first.address }),
      trackChangesScrollToById: await window.__ui.trackChanges.scrollTo(first.id),
      bookmarksHandleKeys: Object.keys(window.__ui.bookmarks),
    };
  });
}

async function checkDecorationSurvives(page) {
  return evalSd(page, async () => {
    const marks = document.querySelectorAll("[data-track-change-id], [class*='track-change'], [data-testid*='track']");
    const first = marks[0];
    if (!first) return { tried: false };
    first.setAttribute("data-sd83-probe", "yes");
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { tried: true, survivedAfter500ms: Boolean(document.querySelector("[data-sd83-probe='yes']")) };
  });
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();

  const largePage = await openDoc(browser, server.url, { doc: LARGE_FIXTURE, mode: "editing" });
  const virtualization = await checkVirtualization(largePage);
  await screenshot(largePage, HERE, "screenshot-large-doc-scrolled-top.png");
  await largePage.close();

  const trackedPage = await openDoc(browser, server.url, { doc: TRACKED_FIXTURE, mode: "editing" });
  const entityVsScroll = await checkEntityGetRectVsScrollIntoView(trackedPage);
  const decoration = await checkDecorationSurvives(trackedPage);
  await screenshot(trackedPage, HERE, "screenshot-tracked-doc.png");

  await browser.close();
  server.stop();

  const result = { version: "2.23.0", largeFixture: LARGE_FIXTURE, trackedFixture: TRACKED_FIXTURE, virtualization, entityVsScroll, decoration };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  console.log("Large doc, near-top block getRect:", JSON.stringify(virtualization.nearTopRect));
  console.log("Large doc, near-end block getRect (scrolled to top):", JSON.stringify(virtualization.nearEndRect));
  console.log("Entity-address getRect:", JSON.stringify(entityVsScroll.getRectByEntityAddress));
  console.log("Entity-address scrollIntoView:", JSON.stringify(entityVsScroll.scrollIntoViewByEntityAddress));
  console.log("trackChanges.scrollTo(id):", JSON.stringify(entityVsScroll.trackChangesScrollToById));
  console.log("bookmarks handle keys (no getRect):", JSON.stringify(entityVsScroll.bookmarksHandleKeys));
  console.log("Decoration attribute survives 500ms:", JSON.stringify(decoration));

  const virtualizationGapConfirmed = virtualization.nearTopRect?.found === true && virtualization.nearEndRect?.found === false;
  const entityGetRectGapConfirmed = entityVsScroll.getRectByEntityAddress?.found === false && entityVsScroll.scrollIntoViewByEntityAddress?.success === true;
  if (virtualizationGapConfirmed && entityGetRectGapConfirmed) {
    console.log("PASS: off-screen text can't be measured, and entity-address getRect is declared-but-not-wired while scrollIntoView/scrollTo work.");
    return;
  }
  console.log("Could not confirm both expected gaps -- see results-2.23.0.json.");
}

await run();
