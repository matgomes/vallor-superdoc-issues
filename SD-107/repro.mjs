import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "_example/sample.docx"; // has 2 tracked changes, no bookmarks

function inspect() {
  const list = window.__sd.activeEditor.doc.trackChanges.list({ limit: 10 });
  return list;
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });

  const list = await evalSd(page, async () => {
    return await window.__sd.activeEditor.doc.trackChanges.list({ limit: 10 });
  });
  const firstId = list.items?.[0]?.id;
  console.log("trackChanges.list ids:", list.items?.map((i) => i.id));

  const getRectResult = await evalSd(page, async (id) => {
    try {
      const result = window.__ui.viewport.getRect({
        target: { kind: "entity", entityType: "trackedChange", entityId: id },
      });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }, firstId);
  console.log("viewport.getRect(trackedChange) ->", JSON.stringify(getRectResult));

  const scrollToResult = await evalSd(page, async (id) => {
    try {
      const result = await window.__ui.trackChanges.scrollTo(id);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }, firstId);
  console.log("ui.trackChanges.scrollTo(id) ->", JSON.stringify(scrollToResult));

  const scrollToElementResult = await evalSd(page, async (id) => {
    try {
      const result = await window.__sd.scrollToElement(id);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }, firstId);
  console.log("superdoc.scrollToElement(id) ->", JSON.stringify(scrollToElementResult));

  const errors = await readErrors(page);
  await browser.close();
  server.stop();

  const output = { firstId, getRectResult, scrollToResult, scrollToElementResult, errors };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(output, null, 2));
  console.log("errors:", JSON.stringify(errors));
  console.log(errors.length === 0 ? "PASS (no console errors)" : "FAIL (console errors present)");
}

await run();
