import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const FIXTURE_REPO_PATH = "SD-47/comments-tc-ids.docx";

async function readCardSignature(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-sd-part="comment-thread"]');
    if (!dialog) return { present: false, ariaLabel: null, bodyText: null };
    const body = dialog.querySelector(".comment-body, .conversation-item");
    return {
      present: true,
      ariaLabel: dialog.getAttribute("aria-label"),
      bodyText: body ? body.textContent.trim() : dialog.textContent.trim().slice(0, 120),
    };
  });
}

async function clickAndCapture(page, text, screenshotName) {
  await page.locator(`text=${text}`).first().click();
  await page.waitForTimeout(500);
  await screenshot(page, SCREENSHOTS_DIR, screenshotName);
  const card = await readCardSignature(page);
  const snapshots = await evalSd(page, () => ({
    commentsActiveId: window.__ui.comments.getSnapshot().activeId,
    trackChangesActiveId: window.__ui.trackChanges.getSnapshot().activeId,
  }));
  return { clickedText: text, card, snapshots };
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "editing",
    commentsDisplay: "inline",
  });
  await page.waitForTimeout(1500);

  const commentOnly = await clickAndCapture(page, "Comment target text one.", "01-click-comment-only.png");
  const trackedChangeOnly = await clickAndCapture(page, "Tracked change target text two.", "02-click-tc-only.png");
  const nested = await clickAndCapture(page, "Nested tracked change inside comment.", "03-click-nested.png");

  const errors = await readErrors(page);
  await browser.close();
  server.stop();

  const result = { commentOnly, trackedChangeOnly, nested, errors };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const commentCardIsCommentShaped = commentOnly.card.ariaLabel?.startsWith("Comment by");
  const trackedChangeCardIsTcShaped = trackedChangeOnly.card.ariaLabel === "Tracked change discussion";
  const nestedOpensCommentCard = nested.card.ariaLabel?.startsWith("Comment by");
  const bugReproduces = commentCardIsCommentShaped && trackedChangeCardIsTcShaped && nestedOpensCommentCard;

  assert.equal(errors.length, 0, `expected no onException/console errors, got ${JSON.stringify(errors)}`);
  console.log(
    bugReproduces
      ? "PASS (bug reproduced): clicking a tracked change nested inside a comment range opens the COMMENT card, not the tracked-change card, on 2.23.0"
      : `FAIL (bug not reproduced as expected): commentCardIsCommentShaped=${commentCardIsCommentShaped} trackedChangeCardIsTcShaped=${trackedChangeCardIsTcShaped} nestedOpensCommentCard=${nestedOpensCommentCard}`,
  );
}

await run();
