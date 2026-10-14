// SD-64: @superdoc-dev/superdoc-yjs-collaboration library defects.
//
// The package under test is intentionally installed only in SD-64/scratch/ (its own
// package.json + node_modules), per the brief: this is a third-party collaboration-glue
// library, not `superdoc` itself, and must not be added to the repo's root package.json.
// This wrapper runs the real checks from there and surfaces the same PASS/FAIL summary,
// so `node SD-64/repro.mjs` from the repo root is still the entrypoint.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = resolvePath(HERE, "scratch");

function onExit(code, chunks, resolve, reject) {
  if (code !== 0) return reject(new Error(`scratch/all-checks.mjs exited with code ${code}`));
  resolve(Buffer.concat(chunks).toString("utf8"));
}

function runScratchChecks() {
  const chunks = [];
  const child = spawn("node", ["all-checks.mjs"], { cwd: SCRATCH, stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    chunks.push(chunk);
  });
  return new Promise((resolve, reject) => child.once("exit", (code) => onExit(code, chunks, resolve, reject)));
}

const output = await runScratchChecks();
const resultsLine = output.split("\n").find((line) => line.startsWith("RESULTS_JSON:"));
if (!resultsLine) throw new Error("scratch/all-checks.mjs did not print a RESULTS_JSON line");
const results = JSON.parse(resultsLine.slice("RESULTS_JSON:".length));

writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(results, null, 2));

const claimResults = [
  results.claim1_readmeExampleCrashes.reproduces,
  results.claim2_expressStyleParams.reproduces,
  results.claim3_unhandledRejection.reproduces,
  results.claim4_onChangeFiresManyTimes.reproduces,
  results.claim5_bundlesOwnYjs.reproduces,
];
const reproducedCount = claimResults.filter(Boolean).length;

console.log(`\nSUMMARY: ${reproducedCount}/5 claims reproduce on @superdoc-dev/superdoc-yjs-collaboration@${results.packageVersionTested} (latest). results-2.23.0.json written.`);
