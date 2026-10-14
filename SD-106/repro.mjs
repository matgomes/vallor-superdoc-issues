// SD-106: no API to author a tracked change with a given author/date/w:id, and
// no way to reinstate ("un-decide") a change once accepted or rejected.
// Demonstrates both gaps on superdoc@2.23.0 / @superdoc/sdk@2.20.0, headless.
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "../_fixtures/dpa-multi-redline.docx");

async function tryDecision(document, id, decision) {
  try {
    const receipt = await document.trackChanges.decide({ target: { kind: "id", id }, decision });
    return { decision, outcome: "resolved", receipt };
  } catch (error) {
    return { decision, outcome: "threw", message: String(error.message ?? error) };
  }
}

async function run() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const { document } = opened;

  const before = await document.trackChanges.list();
  const first = before.items[0];
  const acceptReceipt = await document.trackChanges.decide({ target: { kind: "id", id: first.id }, decision: "accept" });

  const reinstateAttempts = await Promise.all(
    ["undo", "reinstate", "pending", "undecided", "reopen", "unaccept"].map((decision) => tryDecision(document, first.id, decision)),
  );

  const beforeCreate = await document.trackChanges.list();
  await document.create.paragraph({ text: "provenance probe paragraph", changeMode: "tracked" });
  const afterCreate = await document.trackChanges.list();
  const newlyCreated = afterCreate.items.find((item) => !beforeCreate.items.some((old) => old.id === item.id));

  await closeDocx(opened);

  const result = {
    version: "2.23.0",
    fixture: "_fixtures/dpa-multi-redline.docx",
    decidedChangeId: first.id,
    acceptReceipt,
    reinstateAttempts,
    newlyCreatedChange: { author: newlyCreated?.author, date: newlyCreated?.date, origin: newlyCreated?.origin },
  };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  console.log("accept receipt:", JSON.stringify(acceptReceipt));
  for (const attempt of reinstateAttempts) console.log(`decision:"${attempt.decision}" ->`, attempt.outcome, attempt.message ?? "");
  console.log("newly created tracked change author/date:", JSON.stringify(result.newlyCreatedChange));

  const allReinstateRejected = reinstateAttempts.every((attempt) => attempt.outcome === "threw");
  const provenanceForced = newlyCreated?.author === "Probe";
  if (allReinstateRejected && provenanceForced) {
    console.log("CONFIRMED (missing capability): decide() only accepts accept/reject (no reinstate), and create.paragraph forces the caller's own session identity + current time as author/date.");
    return;
  }
  console.log("Could not fully confirm both missing-capability claims -- see results-2.23.0.json.");
}

await run();
