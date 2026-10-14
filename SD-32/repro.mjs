// SD-32: does `export.toDocx({mode:"final"})` (and the browser's `isFinalDoc` flag)
// resolve the full table-structure / formatting revision vocabulary the same way it
// resolves plain w:ins/w:del, and does `report.warnings` flag any that survive?
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx, exportDocx as sdkExportDocx, countTags } from "../harness/lib/sdk.mjs";
import { startServer, launchBrowser, openDoc, screenshot, readErrors, exportDocx as browserExportDocx } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "SD-32/fixture-table-revision-vocabulary.docx";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "fixture-table-revision-vocabulary.docx");

const TAGS = [
  "w:ins",
  "w:del",
  "w:cellIns",
  "w:cellDel",
  "w:cellMerge",
  "w:trPrChange",
  "w:tblPrChange",
  "w:tcPrChange",
  "w:pPrChange",
  "w:rPrChange",
];
// These are expected to resolve to 0 under mode:"final" (plain text revisions).
const PLAIN_TEXT_TAGS = ["w:ins", "w:del"];
// These are the table-structure / formatting revision vocabulary under test.
const STRUCTURAL_TAGS = TAGS.filter((tag) => !PLAIN_TEXT_TAGS.includes(tag));

async function checkHeadlessSdk() {
  const beforeCounts = await countTags(readFileSync(FIXTURE_ABSOLUTE_PATH), TAGS);
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const { buffer, warnings } = await sdkExportDocx(opened.document, "final");
  writeFileSync(resolvePath(HERE, "sdk-final-export.docx"), buffer);
  const afterCounts = await countTags(buffer, TAGS);
  await closeDocx(opened);

  for (const tag of PLAIN_TEXT_TAGS) {
    assert.equal(afterCounts[tag], 0, `expected ${tag} to resolve to 0 under mode:"final", got ${afterCounts[tag]}`);
  }
  const survivors = STRUCTURAL_TAGS.filter((tag) => afterCounts[tag] > 0);
  const warningsMentionSurvivors = survivors.some((tag) =>
    warnings.some((warning) => JSON.stringify(warning).includes(tag.replace("w:", ""))),
  );
  console.log(`headless SDK: before=${JSON.stringify(beforeCounts)}`);
  console.log(`headless SDK: after mode:"final"=${JSON.stringify(afterCounts)}`);
  console.log(`headless SDK: warnings=${JSON.stringify(warnings)}`);
  console.log(`headless SDK: structural tags surviving unresolved: ${JSON.stringify(survivors)}`);
  console.log(`headless SDK: warnings mention any survivor: ${warningsMentionSurvivors}`);
  return { beforeCounts, afterCounts, warnings, survivors, warningsMentionSurvivors };
}

async function checkInBrowser() {
  const server = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
    await screenshot(page, HERE, "screenshots/fixture-in-editor.png");
    const errors = await readErrors(page);
    assert.deepEqual(errors, [], `expected no onException/console errors opening the fixture, got ${JSON.stringify(errors)}`);

    const baseline = await browserExportDocx(page, {});
    const finalDoc = await browserExportDocx(page, { isFinalDoc: true });
    writeFileSync(resolvePath(HERE, "browser-baseline-export.docx"), baseline);
    writeFileSync(resolvePath(HERE, "browser-final-export.docx"), finalDoc);

    const baselineCounts = await countTags(baseline, TAGS);
    const finalCounts = await countTags(finalDoc, TAGS);
    const byteIdentical = baseline.equals(finalDoc);
    console.log(`browser: baseline (no isFinalDoc)=${JSON.stringify(baselineCounts)}`);
    console.log(`browser: isFinalDoc:true=${JSON.stringify(finalCounts)}`);
    console.log(`browser: baseline and isFinalDoc:true byte-identical: ${byteIdentical}`);
    return { baselineCounts, finalCounts, byteIdentical };
  } finally {
    await browser.close();
    server.stop();
  }
}

const sdkResult = await checkHeadlessSdk();
const browserResult = await checkInBrowser();

const verdict = sdkResult.survivors.length > 0 && !sdkResult.warningsMentionSurvivors ? "REPRODUCES" : "FIXED";

const results = {
  issue: "SD-32",
  version: { superdoc: "2.23.0", sdk: "@superdoc/sdk 2.20.0" },
  verdict,
  sdk: sdkResult,
  browser: browserResult,
};
writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(results, null, 2));

console.log(`\n${verdict === "REPRODUCES" ? "PASS (bug reproduced)" : "FAIL (bug not reproduced)"}: ${verdict}`);
console.log(
  `mode:"final" leaves ${sdkResult.survivors.length}/${STRUCTURAL_TAGS.length} structural/formatting revision tag types unresolved: ${sdkResult.survivors.join(", ")}; warnings mention any of them: ${sdkResult.warningsMentionSurvivors}`,
);
console.log(`browser isFinalDoc:true byte-identical to baseline (no-op, matches SD-31): ${browserResult.byteIdentical}`);
