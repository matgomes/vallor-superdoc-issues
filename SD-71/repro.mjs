import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuperDocClient } from "@superdoc/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "synthetic-2000-tracked-insertions.docx");
const MAX_ITERATIONS = 200;
const MAX_WALL_CLOCK_MS = 10 * 60 * 1000; // 10 minutes

function listHostPids() {
  try {
    const output = execSync("ps -eo pid,comm | grep -i 'superdoc' | grep -v grep", { encoding: "utf8" });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/)[0]);
  } catch {
    return [];
  }
}

function readRssKbForPid(pid) {
  try {
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf8" });
    return Number.parseInt(output.trim(), 10);
  } catch {
    return null;
  }
}

async function findHostPid(beforePids) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterPids = listHostPids();
  const newPids = afterPids.filter((pid) => !beforePids.includes(pid));
  return newPids[0] ?? afterPids.at(-1) ?? null;
}

async function runIteration(client, iterationNumber) {
  const document = await client.open({
    doc: FIXTURE_ABSOLUTE_PATH,
    userName: "StressProbe",
    userEmail: "stress-probe@example.com",
  });
  const trackChanges = await document.trackChanges.list({ limit: 50 });
  const comments = await document.comments.list();
  const exported = await document.export.toDocx({ mode: "original" });
  await document.close({ discard: true });
  return {
    iterationNumber,
    trackChangesTotal: trackChanges.total,
    commentsTotal: comments.total,
    exportedByteLength: exported.contentBase64?.length ?? null,
  };
}

async function runLoop({ client, hostPid, iterationNumber, startedAt, iterationResults, memoryCurve }) {
  const elapsedMs = Date.now() - startedAt;
  if (iterationNumber > MAX_ITERATIONS) {
    return { iterationResults, memoryCurve, crashInfo: { crashed: false, error: null, atIteration: null }, stoppedReason: "max-iterations" };
  }
  if (elapsedMs > MAX_WALL_CLOCK_MS) {
    return { iterationResults, memoryCurve, crashInfo: { crashed: false, error: null, atIteration: null }, stoppedReason: "wall-clock-budget" };
  }

  const attempt = await runIteration(client, iterationNumber).then(
    (iterationResult) => ({ succeeded: true, iterationResult }),
    (error) => ({ succeeded: false, error: { name: error?.name, message: error?.message, code: error?.code } }),
  );

  if (!attempt.succeeded) {
    console.log(`CRASH at iteration ${iterationNumber}: ${attempt.error.name} ${attempt.error.message}`);
    return {
      iterationResults,
      memoryCurve,
      crashInfo: { crashed: true, error: attempt.error, atIteration: iterationNumber },
      stoppedReason: "crash",
    };
  }

  const rssKb = hostPid ? readRssKbForPid(hostPid) : null;
  const rssMb = rssKb != null ? Math.round(rssKb / 1024) : null;
  if (iterationNumber % 10 === 0) {
    console.log(`iteration ${iterationNumber}: host RSS ${rssMb ?? "?"} MB`);
  }

  return runLoop({
    client,
    hostPid,
    iterationNumber: iterationNumber + 1,
    startedAt,
    iterationResults: [...iterationResults, attempt.iterationResult],
    memoryCurve: [...memoryCurve, { iterationNumber, t: Date.now() - startedAt, rssMb }],
  });
}

async function run() {
  const beforePids = listHostPids();
  const client = createSuperDocClient({ runtime: "v2" });
  await client.connect();
  const hostPid = await findHostPid(beforePids);
  console.log(`host process pid: ${hostPid ?? "UNKNOWN (could not isolate from concurrent host processes)"}`);

  const { iterationResults, memoryCurve, crashInfo, stoppedReason } = await runLoop({
    client,
    hostPid,
    iterationNumber: 1,
    startedAt: Date.now(),
    iterationResults: [],
    memoryCurve: [],
  });

  const disposeOutcome = await client.dispose().then(
    () => ({ succeeded: true, error: null }),
    (error) => ({ succeeded: false, error: { name: error?.name, message: error?.message } }),
  );

  const result = {
    hostPid,
    iterationsCompleted: iterationResults.length,
    stoppedReason,
    crashInfo,
    disposeOutcome,
    memoryCurve,
    peakRssMb: memoryCurve.reduce((max, entry) => (entry.rssMb != null && entry.rssMb > max ? entry.rssMb : max), 0),
    startRssMb: memoryCurve[0]?.rssMb ?? null,
  };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  console.log(
    crashInfo.crashed
      ? `PASS (bug reproduced): the SDK host process crashed/errored after ${crashInfo.atIteration} iterations: ${crashInfo.error.name} ${crashInfo.error.message}`
      : `NEEDS REPRO (not triggered): completed ${iterationResults.length} iterations without a crash (stopped: ${stoppedReason}). Host RSS went from ${result.startRssMb} MB to a peak of ${result.peakRssMb} MB.`,
  );
}

await run();
