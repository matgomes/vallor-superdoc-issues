import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors, exportDocx } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "SD-55/shared-anchor-comments.docx";
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");

async function runApiPath(server) {
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "editing",
    commentsDisplay: "inline",
  });
  await page.waitForTimeout(1500);

  const before = await evalSd(page, () => window.__ui.comments.list());
  await screenshot(page, SCREENSHOTS_DIR, "01-loaded.png");

  const replyResult = await evalSd(
    page,
    ({ id, text }) => window.__ui.comments.reply(id, { text }),
    { id: "1", text: "Reply to first comment" },
  );
  await page.waitForTimeout(300);
  const afterReply = await evalSd(page, () => window.__ui.comments.list());
  await screenshot(page, SCREENSHOTS_DIR, "02-after-api-reply.png");

  const resolveResult = await evalSd(page, (id) => window.__ui.comments.resolve(id), "2");

  const exportedBuffer = await exportDocx(page);
  writeFileSync(resolvePath(HERE, "exported.docx"), exportedBuffer);
  const exportedZip = await JSZip.loadAsync(exportedBuffer);
  const exportedCommentsXml = await exportedZip.file("word/comments.xml")?.async("string");
  const exportedCommentsExtendedXml = await exportedZip.file("word/commentsExtended.xml")?.async("string");
  const exportedCommentCount = (exportedCommentsXml?.match(/<w:comment\b/g) ?? []).length;

  const errors = await readErrors(page);
  await browser.close();

  return {
    commentCountBeforeReply: before.length,
    commentIdsBeforeReply: before.map((comment) => comment.commentId),
    replyResult,
    commentCountAfterReply: afterReply.length,
    replyCountOnComment1: afterReply.find((comment) => comment.commentId === "1")?.replyCount ?? null,
    resolveResult,
    exportedCommentCount,
    exportedCommentsXml,
    exportedCommentsExtendedXml,
    errors,
  };
}

async function runUiCardPath(server) {
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "editing",
    commentsDisplay: "inline",
  });
  await page.waitForTimeout(1500);

  await page.locator("text=Shared anchor text with two comments.").first().click();
  await page.waitForTimeout(500);
  await screenshot(page, SCREENSHOTS_DIR, "03-card-opened-by-click.png");

  await page.locator("button.reply-pill").click();
  await page.waitForTimeout(300);
  const textarea = page.locator("textarea[data-sd-comment-text]");
  await textarea.click();
  await textarea.fill("Reply typed through the UI composer");
  await screenshot(page, SCREENSHOTS_DIR, "04-reply-composer-filled.png");

  const replyButton = page.locator("button.reply-btn-primary");
  await replyButton.click({ force: true });
  await page.waitForTimeout(1000);
  await screenshot(page, SCREENSHOTS_DIR, "05-after-clicking-reply-button.png");

  const textareaCount = await textarea.count();
  const composerStillOpenWithText = textareaCount > 0 ? await textarea.inputValue() : null;
  const list = await evalSd(page, () => window.__ui.comments.list());
  const errors = await readErrors(page);
  await browser.close();

  return {
    composerStillOpenWithText,
    replyCountOnComment1AfterUiSubmit: list.find((comment) => comment.commentId === "1")?.replyCount ?? null,
    errors,
  };
}

async function run() {
  const server = await startServer();
  const apiPath = await runApiPath(server);
  const uiCardPath = await runUiCardPath(server);
  server.stop();

  const result = { apiPath, uiCardPath };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const apiBugReproduces = apiPath.replyResult.success === false && apiPath.replyResult.failure?.code === "INVALID_CONTEXT";
  const uiBugReproduces =
    uiCardPath.replyCountOnComment1AfterUiSubmit === 0 &&
    uiCardPath.composerStillOpenWithText === "Reply typed through the UI composer";
  assert.equal(apiPath.errors.length, 0, `expected no onException/console errors (API path), got ${JSON.stringify(apiPath.errors)}`);
  assert.equal(uiCardPath.errors.length, 0, `expected no onException/console errors (UI path), got ${JSON.stringify(uiCardPath.errors)}`);
  console.log(
    apiBugReproduces && uiBugReproduces
      ? "PASS (bug reproduced): ui.comments.reply() fails with INVALID_CONTEXT/unsupported-context on 2.23.0, and the comment-card UI composer silently fails the same way (no exception, composer stays open, reply never created)"
      : `FAIL (bug not reproduced as expected): apiBugReproduces=${apiBugReproduces} uiBugReproduces=${uiBugReproduces}`,
  );
}

await run();
