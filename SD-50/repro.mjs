import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

async function tryCreateComment(document, block) {
  const length = block.textPreview ? block.textPreview.length : 10;
  try {
    const result = await document.comments.create({
      text: `Probe comment on ${block.nodeId}`,
      target: { kind: "text", blockId: block.nodeId, range: { start: 0, end: length } },
    });
    return { nodeId: block.nodeId, nodeType: block.nodeType, textPreview: block.textPreview, succeeded: true, commentId: result?.id ?? result?.commentId };
  } catch (error) {
    return {
      nodeId: block.nodeId,
      nodeType: block.nodeType,
      textPreview: block.textPreview,
      succeeded: false,
      error: { name: error?.name, message: error?.message, code: error?.code },
    };
  }
}

async function probeFixture(fixtureRelativePath) {
  const opened = await openDocx(resolvePath(HERE, "..", fixtureRelativePath));
  const blocks = await opened.document.blocks.list();
  const attempts = await blocks.blocks.reduce(async (accumulatorPromise, block) => {
    const accumulator = await accumulatorPromise;
    const attempt = await tryCreateComment(opened.document, block);
    return [...accumulator, attempt];
  }, Promise.resolve([]));
  await closeDocx(opened);
  return { fixture: fixtureRelativePath, attempts };
}

async function run() {
  const fixtureOneResults = await probeFixture("SD-50/near-identical-paragraphs.docx");
  const fixtureTwoResults = await probeFixture("SD-50/near-identical-paragraphs-2.docx");

  const result = { fixtureOneResults, fixtureTwoResults };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const allAttempts = [...fixtureOneResults.attempts, ...fixtureTwoResults.attempts];
  const preconditionFailedHit = allAttempts.find((attempt) => attempt.error?.code === "INTERNAL_ERROR" || /precondition/i.test(attempt.error?.message ?? ""));

  console.log(
    preconditionFailedHit
      ? `PASS (bug reproduced): comments.create() hit a precondition/internal error on blockId ${preconditionFailedHit.nodeId} ("${preconditionFailedHit.textPreview}"), on 2.23.0`
      : `NEEDS REPRO (not triggered): comments.create() succeeded (or failed with an unrelated, expected error) on every paragraph variant tried across both fixtures`,
  );
}

await run();
