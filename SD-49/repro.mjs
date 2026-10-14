import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const FIXTURE_REPO_PATH = "SD-49/spread-changes-and-comments.docx";

async function cardIsPresent(page) {
  return page.evaluate(() => !!document.querySelector('[data-sd-part="comment-thread"]'));
}

async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.mouse.wheel(0, 2_000_000);
  await page.waitForTimeout(1500);
}

async function openFixture(server) {
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "editing",
    commentsDisplay: "inline",
  });
  await page.waitForTimeout(1500);
  return { browser, page };
}

async function findingSetActiveDoesNotOpenCard(server) {
  const { browser, page } = await openFixture(server);

  const trackChangesList = await evalSd(page, () => window.__ui.trackChanges.list());
  const firstTrackChangeId = trackChangesList[0].id;
  const tcSetActiveResult = await evalSd(page, (id) => window.__ui.trackChanges.setActive(id), firstTrackChangeId);
  await page.waitForTimeout(400);
  const cardAfterTcSetActive = await cardIsPresent(page);
  const tcActiveIdAfterSetActive = (await evalSd(page, () => window.__ui.trackChanges.getSnapshot())).activeId;
  await screenshot(page, SCREENSHOTS_DIR, "01-after-trackchanges-setactive.png");

  const commentsList = await evalSd(page, () => window.__ui.comments.list());
  const firstCommentId = commentsList[0].commentId;
  const commentSetActiveResult = await evalSd(page, (id) => window.__ui.comments.setActive(id), firstCommentId);
  await page.waitForTimeout(400);
  const cardAfterCommentSetActive = await cardIsPresent(page);
  const commentActiveIdAfterSetActive = (await evalSd(page, () => window.__ui.comments.getSnapshot())).activeId;
  await screenshot(page, SCREENSHOTS_DIR, "02-after-comments-setactive.png");

  const errors = await readErrors(page);
  await browser.close();

  return {
    tcSetActiveResult,
    cardAfterTcSetActive,
    tcActiveIdAfterSetActive,
    commentSetActiveResult,
    cardAfterCommentSetActive,
    commentActiveIdAfterSetActive,
    errors,
  };
}

async function findingPaintedWindowListing(server) {
  const { browser, page } = await openFixture(server);

  const atTop = await evalSd(page, () => window.__ui.trackChanges.list());
  await screenshot(page, SCREENSHOTS_DIR, "03-trackchanges-at-top.png");

  await scrollToBottom(page);
  const atBottom = await evalSd(page, () => window.__ui.trackChanges.list());
  await screenshot(page, SCREENSHOTS_DIR, "04-trackchanges-at-bottom.png");

  const errors = await readErrors(page);
  await browser.close();

  return {
    atTopCount: atTop.length,
    atTopIds: atTop.map((item) => item.id),
    atBottomCount: atBottom.length,
    atBottomIds: atBottom.map((item) => item.id),
    errors,
  };
}

async function findingNavigateNextOffWindowTarget(server) {
  const { browser, page } = await openFixture(server);

  const list = await evalSd(page, () => window.__ui.trackChanges.list());
  const onlyVisibleId = list[0].id;
  await evalSd(page, (id) => window.__ui.trackChanges.setActive(id), onlyVisibleId);
  await page.waitForTimeout(400);
  const activeIdBeforeNavigate = (await evalSd(page, () => window.__ui.trackChanges.getSnapshot())).activeId;

  const navigateOutcome = await page.evaluate(async () => {
    const outcome = await Promise.race([
      window.__ui.trackChanges.navigateNext().then((value) => ({ settledWithin4s: true, value })),
      new Promise((resolve) => setTimeout(() => resolve({ settledWithin4s: false, value: null }), 4000)),
    ]);
    return outcome;
  });
  await page.waitForTimeout(400);
  const activeIdAfterNavigate = (await evalSd(page, () => window.__ui.trackChanges.getSnapshot())).activeId;
  const cardAfterNavigate = await cardIsPresent(page);
  await screenshot(page, SCREENSHOTS_DIR, "05-after-navigatenext-off-window-target.png");

  const errors = await readErrors(page);
  await browser.close();

  return {
    onlyVisibleId,
    activeIdBeforeNavigate,
    navigateOutcome,
    activeIdAfterNavigate,
    navigateActuallyMovedActiveId: activeIdBeforeNavigate !== activeIdAfterNavigate,
    cardAfterNavigate,
    errors,
  };
}

async function findingIntegratorNextChangeButton(server) {
  const { browser, page } = await openFixture(server);

  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "integrator-next-change-button";
    button.textContent = "Next change";
    button.style.cssText = "position:fixed;top:8px;right:8px;z-index:999999;padding:8px 12px;";
    button.onclick = () => {
      window.__integratorNavigateResult = null;
      window.__ui.trackChanges.navigateNext().then((result) => {
        window.__integratorNavigateResult = result;
      });
    };
    document.body.appendChild(button);
  });

  const list = await evalSd(page, () => window.__ui.trackChanges.list());
  await evalSd(page, (id) => window.__ui.trackChanges.setActive(id), list[0].id);
  await page.waitForTimeout(400);

  await page.click("#integrator-next-change-button");
  await page.waitForTimeout(1500);
  await screenshot(page, SCREENSHOTS_DIR, "06-integrator-next-change-button-clicked.png");

  const integratorResult = await page.evaluate(() => window.__integratorNavigateResult);
  const activeIdAfterClick = (await evalSd(page, () => window.__ui.trackChanges.getSnapshot())).activeId;
  const cardAfterClick = await cardIsPresent(page);

  await browser.close();
  return { integratorResult, activeIdAfterClick, cardAfterClick };
}

async function run() {
  const server = await startServer();

  const setActiveFindings = await findingSetActiveDoesNotOpenCard(server);
  const paintedWindowFindings = await findingPaintedWindowListing(server);
  const navigateNextFindings = await findingNavigateNextOffWindowTarget(server);
  const integratorButtonFindings = await findingIntegratorNextChangeButton(server);

  server.stop();

  const result = { setActiveFindings, paintedWindowFindings, navigateNextFindings, integratorButtonFindings };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const allErrors = [
    ...setActiveFindings.errors,
    ...paintedWindowFindings.errors,
    ...navigateNextFindings.errors,
  ];
  assert.equal(allErrors.length, 0, `expected no onException/console errors, got ${JSON.stringify(allErrors)}`);

  const setActiveBugReproduces =
    setActiveFindings.tcSetActiveResult === true &&
    setActiveFindings.cardAfterTcSetActive === false &&
    setActiveFindings.commentSetActiveResult === true &&
    setActiveFindings.cardAfterCommentSetActive === false;
  const paintedWindowBugReproduces =
    paintedWindowFindings.atTopCount === 1 &&
    paintedWindowFindings.atBottomCount === 1 &&
    paintedWindowFindings.atTopIds[0] !== paintedWindowFindings.atBottomIds[0];
  const navigateNextBugReproduces = navigateNextFindings.navigateActuallyMovedActiveId === false;
  const integratorButtonBugReproduces = integratorButtonFindings.cardAfterClick === false;

  console.log(
    `setActiveBugReproduces=${setActiveBugReproduces} paintedWindowBugReproduces=${paintedWindowBugReproduces} navigateNextBugReproduces=${navigateNextBugReproduces} integratorButtonBugReproduces=${integratorButtonBugReproduces}`,
  );
  console.log(
    setActiveBugReproduces && paintedWindowBugReproduces && navigateNextBugReproduces && integratorButtonBugReproduces
      ? "PASS (bugs reproduced): setActive() does not open a card; trackChanges.list() only reaches changes in the currently-painted page window; navigateNext() is a no-op toward an off-window target; an integrator's own 'next change' button wired to navigateNext() visibly does nothing, on 2.23.0"
      : "FAIL (one or more findings did not reproduce as expected) — see per-finding booleans above",
  );
}

await run();
