import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, screenshot } from "../harness/lib/browser.mjs";
import { startCollabServer } from "../harness/lib/collab-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const SEED_REPO_PATH = "SD-60/seed.docx";

async function openRoom(server, collabServer, roomId, roomMode, screenshotName) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const query = new URLSearchParams({
    doc: SEED_REPO_PATH,
    collab: `${collabServer.url},${roomId},${roomMode}`,
  });
  await page.goto(`${server.url}/harness/index.html?${query.toString()}`);
  await page.bringToFront();
  await page.waitForFunction(() => window.__ui !== undefined || window.__errors.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  const editorIsNull = await page.evaluate(() => window.__sd?.activeEditor == null);
  const errors = await page.evaluate(() => window.__errors);
  await screenshot(page, SCREENSHOTS_DIR, screenshotName);

  return { roomMode, editorIsNull, errors, browser };
}

async function run() {
  const server = await startServer();
  const collabServer = await startCollabServer();

  const unseededRoomId = "sd60-unseeded";
  const joinUnseeded = await openRoom(server, collabServer, unseededRoomId, "join", "01-join-unseeded.png");
  await joinUnseeded.browser.close();

  const existingRoomId = "sd60-existing";
  const createFirst = await openRoom(server, collabServer, existingRoomId, "create", "02-create-first.png");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const createAgain = await openRoom(server, collabServer, existingRoomId, "create", "03-create-again.png");

  await createFirst.browser.close();
  await createAgain.browser.close();
  collabServer.stop();
  server.stop();

  const result = {
    joinUnseeded: { roomMode: joinUnseeded.roomMode, editorIsNull: joinUnseeded.editorIsNull, errors: joinUnseeded.errors },
    createFirst: { roomMode: createFirst.roomMode, editorIsNull: createFirst.editorIsNull, errors: createFirst.errors },
    createAgain: { roomMode: createAgain.roomMode, editorIsNull: createAgain.editorIsNull, errors: createAgain.errors },
  };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const joinUnseededCode = joinUnseeded.errors[0]?.code;
  const createAgainCode = createAgain.errors[0]?.code;
  const bugReproduces = createAgainCode === "collaboration-v2-room-already-exists" && createAgain.editorIsNull;
  console.log(
    bugReproduces
      ? `PASS (bug reproduced): roomMode:"create" on an existing room fails with ${createAgainCode}, editor stays null, on 2.23.0. Join-unseeded gives ${joinUnseededCode}.`
      : `FAIL (bug not reproduced as expected): createAgainCode=${createAgainCode} editorIsNull=${createAgain.editorIsNull}`,
  );
}

await run();
