// SD-38: bookmarks.get() on a missing bookmark rejects with TARGET_NOT_FOUND
// wrapped one level down inside a generic WorkerTransportError
// {code:"execution-error", reason:<engine code>} in the BROWSER, instead of
// a clean top-level error code. Confirms this is transport-specific: the
// headless Node SDK (a CLI child-process transport, not a worker) reports a
// clean top-level `code: "TARGET_NOT_FOUND"` with no wrapper at all.
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd } from "../harness/lib/browser.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "_fixtures/bookmark-x1-plain.docx";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "../_fixtures/bookmark-x1-plain.docx");
const MISSING_TARGET = { kind: "entity", entityType: "bookmark", name: "definitely-does-not-exist" };

async function checkBrowser(server, browser) {
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
  const result = await evalSd(
    page,
    async (target) => {
      try {
        const value = await window.__sd.activeEditor.doc.bookmarks.get({ target });
        return { outcome: "resolved", value };
      } catch (error) {
        return {
          outcome: "threw",
          constructorName: error.constructor?.name,
          name: error.name,
          topLevelCode: error.code,
          nestedReason: error.reason,
          message: error.message,
        };
      }
    },
    MISSING_TARGET,
  );
  await page.close();
  return result;
}

async function checkHeadlessSdk() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  try {
    const value = await opened.document.bookmarks.get({ target: MISSING_TARGET });
    return { outcome: "resolved", value };
  } catch (error) {
    return { outcome: "threw", constructorName: error.constructor?.name, name: error.name, topLevelCode: error.code, message: error.message };
  } finally {
    await closeDocx(opened);
  }
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();

  const browserResult = await checkBrowser(server, browser);
  const sdkResult = await checkHeadlessSdk();

  await browser.close();
  server.stop();

  const result = { version: "2.23.0", fixture: FIXTURE_REPO_PATH, browser: browserResult, headlessSdk: sdkResult };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  console.log("Browser:", JSON.stringify(browserResult));
  console.log("Headless SDK:", JSON.stringify(sdkResult));

  const browserWrapped = browserResult.outcome === "threw" && browserResult.name === "WorkerTransportError" && browserResult.topLevelCode === "execution-error" && browserResult.nestedReason === "TARGET_NOT_FOUND";
  const sdkClean = sdkResult.outcome === "threw" && sdkResult.topLevelCode === "TARGET_NOT_FOUND";
  if (browserWrapped && sdkClean) {
    console.log("REPRODUCES on 2.23.0 (browser only): bookmarks.get() on a missing bookmark rejects with the real engine code (TARGET_NOT_FOUND) nested one level down inside a generic WorkerTransportError{code:'execution-error'}; the headless SDK's CLI transport reports a clean top-level code for the same call.");
    return;
  }
  console.log("Could not confirm the expected browser-vs-SDK split -- see results-2.23.0.json.");
}

await run();
