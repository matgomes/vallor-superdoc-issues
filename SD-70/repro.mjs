import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, screenshot } from "../harness/lib/browser.mjs";
import { startCollabServer } from "../harness/lib/collab-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const ATTEMPT_COUNT = 3;

async function raceWithTimeout(promise, timeoutMs, timeoutValue) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs))]);
}

async function attemptFreshRoomImmediateList(server, collabServer, attemptNumber) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const roomId = `sd70-fresh-${attemptNumber}`;
  const query = new URLSearchParams({
    doc: "SD-70/seed-with-comment.docx",
    collab: `${collabServer.url},${roomId},create`,
  });
  await page.goto(`${server.url}/harness/index.html?${query.toString()}`);
  await page.bringToFront();

  const timedOut = Symbol("timedOut");
  const evaluatePromise = page.evaluate(async () => {
    const innerTimedOut = Symbol("innerTimedOut");
    const readyOutcome = await Promise.race([
      window.__ready.then(() => "ready"),
      new Promise((resolve) => setTimeout(() => resolve(innerTimedOut), 15000)),
    ]);
    if (readyOutcome === innerTimedOut) {
      return { readyFired: false, uiListOutcome: null, docListOutcome: null, errors: window.__errors };
    }

    const tryCall = async (fn) => {
      try {
        const value = await fn();
        return { succeeded: true, value, error: null };
      } catch (error) {
        return { succeeded: false, value: null, error: { name: error?.name, message: error?.message, code: error?.code } };
      }
    };

    const uiListOutcome = await tryCall(() => window.__ui.comments.list());
    const docListOutcome = await tryCall(() => window.__sd.activeEditor.doc.comments.list());
    return { readyFired: true, uiListOutcome, docListOutcome, errors: window.__errors };
  });

  const attempt = await raceWithTimeout(evaluatePromise, 20000, timedOut);
  if (attempt === timedOut) {
    await screenshot(page, SCREENSHOTS_DIR, `attempt-${attemptNumber}-NODE-TIMEOUT.png`);
    await browser.close();
    return { attemptNumber, readyFired: false, uiListOutcome: null, docListOutcome: null, errors: [] };
  }

  await screenshot(page, SCREENSHOTS_DIR, `attempt-${attemptNumber}.png`);
  await browser.close();
  return { attemptNumber, ...attempt };
}

async function runAttemptsSequentially(server, collabServer) {
  return Array.from({ length: ATTEMPT_COUNT }, (_, index) => index + 1).reduce(
    async (accumulatorPromise, attemptNumber) => {
      const accumulator = await accumulatorPromise;
      const attempt = await attemptFreshRoomImmediateList(server, collabServer, attemptNumber);
      return [...accumulator, attempt];
    },
    Promise.resolve([]),
  );
}

async function run() {
  const server = await startServer();
  const collabServer = await startCollabServer();

  const attempts = await runAttemptsSequentially(server, collabServer);

  collabServer.stop();
  server.stop();

  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(attempts, null, 2));
  console.log(JSON.stringify(attempts, null, 2));

  const anyFailed = attempts.some(
    (attempt) => attempt.uiListOutcome?.succeeded === false || attempt.docListOutcome?.succeeded === false,
  );
  console.log(
    anyFailed
      ? `PASS (bug reproduced): a comments.list() call immediately after onReady in a freshly-created room failed on at least one of ${attempts.length} attempts, on 2.23.0`
      : `NEEDS REPRO (not triggered): comments.list() succeeded immediately after onReady on all ${attempts.length} fresh-room attempts`,
  );
}

await run();
