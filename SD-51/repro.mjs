import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, evalSd, screenshot } from "../harness/lib/browser.mjs";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "base-for-streaming.docx");
const POLL_INTERVAL_MS = 500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBrowserJoiner(server, collabServer, roomId) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const query = new URLSearchParams({
    doc: "SD-51/base-for-streaming.docx",
    collab: `${collabServer.url},${roomId},join`,
  });
  await page.goto(`${server.url}/harness/index.html?${query.toString()}`);
  await page.bringToFront();
  await page.waitForFunction(() => window.__ui !== undefined, null, { timeout: 20000 });
  return { browser, page };
}

async function pollCommentsTotal(page, pollLog, stopFlag) {
  while (!stopFlag.stopped) {
    const snapshot = await evalSd(page, () => window.__ui.comments.getSnapshot());
    pollLog.push({ t: Date.now(), total: snapshot.total });
    await wait(POLL_INTERVAL_MS);
  }
}

async function scenarioTextEditStream(server, collabServer) {
  const roomId = "sd51-text-edit-stream";
  const seed = await seedRoomFromDocx(collabServer.url, roomId, FIXTURE_ABSOLUTE_PATH);
  const { browser, page } = await openBrowserJoiner(server, collabServer, roomId);
  await screenshot(page, SCREENSHOTS_DIR, "01-text-stream-joined.png");

  const pollLog = [];
  const stopFlag = { stopped: false };
  const pollingPromise = pollCommentsTotal(page, pollLog, stopFlag);

  const collaborator = await openDocx(FIXTURE_ABSOLUTE_PATH, { collaboration: { url: collabServer.url, documentId: roomId, roomMode: "join" } });
  const blocks = await collaborator.document.blocks.list();
  const secondParagraphId = blocks.blocks[1].nodeId;
  const firstParagraphId = blocks.blocks[0].nodeId;

  const commentCreatedAt = Date.now();
  await collaborator.document.comments.create({
    text: "New comment created mid text-edit stream",
    target: { kind: "text", blockId: secondParagraphId, range: { start: 0, end: 10 } },
  });

  await Array.from({ length: 8 }, (_, index) => index).reduce(async (accumulatorPromise, index) => {
    await accumulatorPromise;
    const point = { kind: "text", blockId: firstParagraphId, offset: 0 };
    await collaborator.document.insert({ value: `x${index} `, target: { kind: "selection", start: point, end: point } });
    await wait(2000);
  }, Promise.resolve());

  await screenshot(page, SCREENSHOTS_DIR, "02-text-stream-ended.png");
  await wait(8000);
  await screenshot(page, SCREENSHOTS_DIR, "03-text-stream-after-quiet-period.png");

  stopFlag.stopped = true;
  await pollingPromise;
  const finalTotal = (await evalSd(page, () => window.__ui.comments.getSnapshot())).total;

  await closeDocx(collaborator);
  await browser.close();
  await seed.release();

  return {
    commentCreatedAt,
    pollLog: pollLog.map((entry) => ({ msSinceCommentCreated: entry.t - commentCreatedAt, total: entry.total })),
    finalTotal,
  };
}

async function scenarioCommentCreationStream(server, collabServer) {
  const roomId = "sd51-comment-stream";
  const seed = await seedRoomFromDocx(collabServer.url, roomId, FIXTURE_ABSOLUTE_PATH);
  const { browser, page } = await openBrowserJoiner(server, collabServer, roomId);

  const pollLog = [];
  const stopFlag = { stopped: false };
  const pollingPromise = pollCommentsTotal(page, pollLog, stopFlag);

  const collaborator = await openDocx(FIXTURE_ABSOLUTE_PATH, { collaboration: { url: collabServer.url, documentId: roomId, roomMode: "join" } });
  const blocks = await collaborator.document.blocks.list();
  const secondParagraphId = blocks.blocks[1].nodeId;

  const streamStartedAt = Date.now();
  await Array.from({ length: 6 }, (_, index) => index).reduce(async (accumulatorPromise, index) => {
    await accumulatorPromise;
    await collaborator.document.comments.create({
      text: `Streamed comment ${index}`,
      target: { kind: "text", blockId: secondParagraphId, range: { start: 0, end: 5 } },
    });
    await wait(1500);
  }, Promise.resolve());

  await wait(8000);
  stopFlag.stopped = true;
  await pollingPromise;
  const finalTotal = (await evalSd(page, () => window.__ui.comments.getSnapshot())).total;

  await closeDocx(collaborator);
  await browser.close();
  await seed.release();

  return {
    streamStartedAt,
    expectedFinalTotal: 6,
    pollLog: pollLog.map((entry) => ({ msSinceStreamStart: entry.t - streamStartedAt, total: entry.total })),
    finalTotal,
  };
}

async function run() {
  const server = await startServer();
  const collabServer = await startCollabServer();

  const textEditStream = await scenarioTextEditStream(server, collabServer);
  const commentCreationStream = await scenarioCommentCreationStream(server, collabServer);

  collabServer.stop();
  server.stop();

  const result = { textEditStream, commentCreationStream };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const textStreamNeverShowedCommentWhileStreaming = !textEditStream.pollLog
    .filter((entry) => entry.msSinceCommentCreated < 16000)
    .some((entry) => entry.total >= 1);
  const textStreamShowedCommentAfterQuiet = textEditStream.finalTotal >= 1;
  const commentStreamLaggedSignificantly = commentCreationStream.finalTotal < commentCreationStream.expectedFinalTotal;

  console.log(
    `textEditStream: neverVisibleWhileStreaming=${textStreamNeverShowedCommentWhileStreaming} visibleAfterQuiet=${textStreamShowedCommentAfterQuiet}`,
  );
  console.log(
    `commentCreationStream: finalTotal=${commentCreationStream.finalTotal} expected=${commentCreationStream.expectedFinalTotal} laggedSignificantly=${commentStreamLaggedSignificantly}`,
  );
  console.log(
    textStreamNeverShowedCommentWhileStreaming && textStreamShowedCommentAfterQuiet
      ? "PASS (bug reproduced): a new comment stayed invisible to ui.comments while edits streamed in, appearing only after the stream went quiet, on 2.23.0"
      : "NEEDS REPRO (not triggered): the new comment became visible to ui.comments promptly in both the text-edit-stream and comment-creation-stream scenarios, well before the 6.5s idle window this report hypothesizes",
  );
}

await run();
