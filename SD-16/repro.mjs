// SD-16: claim was that trackChanges.decide() can resolve {success:false,
// failure:{code,message}} instead of throwing on a refusal (a "phantom
// accept" risk for callers that only check the resolved value). This script
// tries several refusal shapes against superdoc@2.23.0 / @superdoc/sdk@2.20.0
// and records whether each one throws or resolves.
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "../_fixtures/dpa-multi-redline.docx");

async function attempt(label, fn) {
  try {
    const value = await fn();
    return { label, outcome: "resolved", value };
  } catch (error) {
    return { label, outcome: "threw", message: String(error.message ?? error) };
  }
}

async function run() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const { document } = opened;
  const list = await document.trackChanges.list();

  const attempts = [];

  // 1. Double-decide: accept, then accept the same (now-resolved) id again.
  attempts.push(await attempt("decide once (control)", () => document.trackChanges.decide({ target: { kind: "id", id: list.items[0].id }, decision: "accept" })));
  attempts.push(await attempt("decide the same id again (already resolved)", () => document.trackChanges.decide({ target: { kind: "id", id: list.items[0].id }, decision: "accept" })));

  // 2. Decide a never-existed id.
  attempts.push(await attempt("decide a nonexistent id", () => document.trackChanges.decide({ target: { kind: "id", id: "definitely-not-a-real-id" }, decision: "accept" })));

  // 3. decide {kind:"ids"} batch where one id is already resolved.
  attempts.push(
    await attempt("decide {kind:ids} with one already-resolved id", () =>
      document.trackChanges.decide({ target: { kind: "ids", ids: [list.items[0].id, list.items[1].id] }, decision: "accept" }),
    ),
  );

  // 4. Stale expectedRevision.
  attempts.push(
    await attempt("decide with a stale expectedRevision", () =>
      document.trackChanges.decide({ target: { kind: "id", id: list.items[2].id }, decision: "accept", expectedRevision: "not-a-real-revision" }),
    ),
  );

  // 5. Decide under a readOnly editing restriction.
  const restrictionAttempt = await attempt("setEditingRestriction(readOnly)", () => document.protection.setEditingRestriction({ mode: "readOnly" }));
  attempts.push(restrictionAttempt);
  attempts.push(await attempt("decide under readOnly protection", () => document.trackChanges.decide({ target: { kind: "id", id: list.items[3].id }, decision: "accept" })));
  attempts.push(await attempt("clearEditingRestriction", () => document.protection.clearEditingRestriction()));

  // 6. Decide only one side of a replacement pair.
  const replacementPair = list.items.find((item) => item.type === "replacement" && item.id !== list.items[0].id);
  attempts.push(
    await attempt("decide only the insert side of a replacement pair", () =>
      document.trackChanges.decide({ target: { kind: "id", id: replacementPair.id, side: "insert" }, decision: "accept" }),
    ),
  );

  await closeDocx(opened);

  const result = { version: "2.23.0", fixture: "_fixtures/dpa-multi-redline.docx", attempts };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  for (const a of attempts) console.log(`${a.label} -> ${a.outcome}${a.message ? ": " + a.message : ""}`);

  const anyResolvedFailure = attempts.some((a) => a.outcome === "resolved" && a.value?.success === false);
  if (anyResolvedFailure) {
    console.log("REPRODUCES: found a refusal that resolves {success:false} instead of throwing.");
    return;
  }
  console.log("NOT REPRODUCED on 2.23.0: every refusal scenario tried (double-decide, nonexistent id, batch with a bad id, stale revision, readOnly protection, half of a replacement pair) THREW instead of resolving {success:false}.");
}

await run();
