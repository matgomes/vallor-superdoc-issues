// SD-39: bookmarks.insert() allegedly refuses an end offset exactly at a
// paragraph's text length for some Word-authored paragraphs, but accepts
// length-1. Sweeps real, Word-derived fixtures on superdoc@2.23.0 /
// @superdoc/sdk@2.20.0 looking for that exact asymmetry.
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolvePath(HERE, "../_fixtures");

// Every fixture in _fixtures/ (excluding the ~200-page template, too slow for the time
// box) — synthetic bookmark-edge-case documents plus real, Word-derived contracts with
// varied paragraph shapes (plain clauses, headings, list items, table cells, tracked
// changes, comments).
const FIXTURES = readdirSync(FIXTURES_DIR).filter((file) => file.endsWith(".docx") && file !== "msa-200-pages-template.docx");

const bookmarkCounter = { value: 0 };
function nextBookmarkName() {
  bookmarkCounter.value += 1;
  return `probe_${bookmarkCounter.value}`;
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms))]);
}

async function testParagraph(document, block) {
  const length = block.text.length;
  const insertAt = (end) =>
    withTimeout(
      document.bookmarks.insert({ name: nextBookmarkName(), at: { kind: "text", segments: [{ blockId: block.nodeId, range: { start: 0, end } }] } }),
      5000,
      "insert",
    );
  const atLength = await insertAt(length).then(() => ({ ok: true })).catch((error) => ({ ok: false, message: String(error.message ?? error) }));
  const atLengthMinusOne = length > 0 ? await insertAt(length - 1).then(() => ({ ok: true })).catch((error) => ({ ok: false, message: String(error.message ?? error) })) : null;
  return { blockId: block.nodeId, length, text: block.text.slice(0, 60), atLength, atLengthMinusOne };
}

async function testCandidatesSequentially(document, candidates) {
  if (candidates.length === 0) return [];
  const [first, ...rest] = candidates;
  const firstResult = await testParagraph(document, first);
  return [firstResult, ...(await testCandidatesSequentially(document, rest))];
}

async function testFixture(fixture) {
  const opened = await withTimeout(openDocx(resolvePath(FIXTURES_DIR, fixture)), 15000, "open").catch((error) => ({ failed: true, error }));
  if (opened.failed) return { fixture, skipped: true, reason: String(opened.error.message ?? opened.error) };

  const { document } = opened;
  const blocks = await withTimeout(document.blocks.list({ includeText: true }), 10000, "blocks.list");
  const candidates = blocks.blocks.filter((block) => !block.nodeId.startsWith("tbl:") && (block.text ?? "").length > 0);
  const results = await testCandidatesSequentially(document, candidates);
  await withTimeout(closeDocx(opened), 10000, "close");
  return { fixture, skipped: false, paragraphsTested: results.length, results };
}

async function testFixturesSequentially(fixtures) {
  if (fixtures.length === 0) return [];
  const [first, ...rest] = fixtures;
  const firstResult = await testFixture(first);
  return [firstResult, ...(await testFixturesSequentially(rest))];
}

async function run() {
  const perFixture = await testFixturesSequentially(FIXTURES);

  const matches = perFixture
    .filter((entry) => !entry.skipped)
    .flatMap((entry) =>
      entry.results
        .filter((result) => !result.atLength.ok && result.atLengthMinusOne?.ok)
        .map((result) => ({ fixture: entry.fixture, ...result })),
    );
  const substantialMatches = matches.filter((match) => match.length >= 10);
  const totalTested = perFixture.reduce((sum, entry) => sum + (entry.paragraphsTested ?? 0), 0);

  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify({ version: "2.23.0", fixturesTested: FIXTURES, totalParagraphsTested: totalTested, perFixture, matches }, null, 2));

  console.log(`Tested ${totalTested} paragraphs across ${FIXTURES.length} fixtures.`);
  console.log(`Found ${matches.length} total end=L-fails/end=L-1-succeeds matches (${substantialMatches.length} on paragraphs >= 10 chars).`);
  for (const match of matches) console.log(`  ${match.fixture} block ${match.blockId} (len ${match.length}) text="${match.text}" -> ${match.atLength.message}`);

  if (substantialMatches.length > 0) {
    console.log("REPRODUCES on 2.23.0: found a real paragraph where bookmarks.insert refuses end=length but accepts end=length-1.");
    return;
  }
  console.log(`NOT REPRODUCED on 2.23.0 for substantial (>=10 char) paragraphs across ${FIXTURES.length} fixtures. Only degenerate near-empty paragraphs (if any) showed the pattern -- see results-2.23.0.json.`);
}

await run();
