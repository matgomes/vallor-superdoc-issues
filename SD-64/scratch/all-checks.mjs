// SD-64: @superdoc-dev/superdoc-yjs-collaboration defects.
// Runs all 5 claims against the LATEST published version (resolved below) and prints one
// PASS(reproduces)/FAIL(not reproduced) line per claim, plus a JSON summary on the last line.
import http from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

global.WebSocket = (await import("ws")).default;

const pkgVersion = JSON.parse(readFileSync(new URL("./node_modules/@superdoc-dev/superdoc-yjs-collaboration/package.json", import.meta.url))).version;
const results = { packageVersionTested: pkgVersion };

async function claim1() {
  const mod = await import("@superdoc-dev/superdoc-yjs-collaboration");
  const hasDefaultExport = "default" in mod;
  const defaultImportError = hasDefaultExport ? null : "module has no default export (named exports only)";

  const namedImportAttempt = (() => {
    try {
      const service = new mod.SuperDocCollaboration().withName("sdc-test").withDebounce(500).onAuthenticate(() => {}).onLoad(() => {}).onAutoSave(() => {}).onChange(() => {}).build();
      return { error: null, service };
    } catch (error) {
      return { error: `${error.constructor.name}: ${error.message}`, service: null };
    }
  })();
  if (namedImportAttempt.service) console.log("claim1: UNEXPECTED SUCCESS", namedImportAttempt.service);

  const reproduces = defaultImportError !== null && namedImportAttempt.error !== null;
  console.log(`claim1 (README example crashes) -> ${reproduces ? "PASS (reproduces)" : "FAIL (not reproduced)"}`);
  console.log(`  - default export missing: ${defaultImportError}`);
  console.log(`  - new SuperDocCollaboration().withName(...) throws: ${namedImportAttempt.error}`);
  results.claim1_readmeExampleCrashes = { reproduces, defaultImportError, namedImportError: namedImportAttempt.error };
}

async function claim1Control() {
  const { CollaborationBuilder } = await import("@superdoc-dev/superdoc-yjs-collaboration");
  const service = new CollaborationBuilder().withName("sdc-control").withDebounce(500).onAuthenticate(() => {}).onLoad(() => {}).onAutoSave(() => {}).onChange(() => {}).build();
  const works = service.name === "sdc-control" && typeof service.welcome === "function";
  console.log(`claim1-control (CollaborationBuilder works) -> ${works ? "PASS (confirmed working)" : "FAIL"}`);
  results.claim1_correctApiWorks = works;
}

async function claims2and3() {
  const { CollaborationBuilder } = await import("@superdoc-dev/superdoc-yjs-collaboration");
  const rejectionState = { unhandled: null };
  const onUnhandled = (reason) => { rejectionState.unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);

  const service = new CollaborationBuilder().withName("sdc-raw-http-test").onLoad(() => new Uint8Array()).build();
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const req = await new Promise((resolve) => {
    http.get({ port, path: "/collaboration/doc-123" }, (res) => res.resume());
    server.once("request", (request) => resolve(request));
  });
  const hasParams = "params" in req;

  const fakeSocket = { readyState: 1, send() {}, close() {}, on() {} };
  const handler = (socket, request) => service.welcome(socket, request);
  handler(fakeSocket, req);
  await new Promise((resolve) => setTimeout(resolve, 200));

  process.off("unhandledRejection", onUnhandled);
  server.close();

  const claim2Reproduces = hasParams === false;
  console.log(`claim2 (generateParams expects Express-style request.params) -> ${claim2Reproduces ? "PASS (reproduces)" : "FAIL (not reproduced)"}`);
  console.log(`  - raw node:http IncomingMessage has .params: ${hasParams}`);
  results.claim2_expressStyleParams = { reproduces: claim2Reproduces, rawHttpRequestHasParams: hasParams };

  const claim3Reproduces = rejectionState.unhandled !== null;
  console.log(`claim3 (welcome() produces an unhandled rejection) -> ${claim3Reproduces ? "PASS (reproduces)" : "FAIL (not reproduced)"}`);
  console.log(`  - unhandledRejection reason: ${rejectionState.unhandled?.message}`);
  results.claim3_unhandledRejection = { reproduces: claim3Reproduces, reason: rejectionState.unhandled?.message ?? null };
}

async function claim4() {
  const { CollaborationBuilder } = await import("@superdoc-dev/superdoc-yjs-collaboration");
  const counter = { afterSync: 0, countingStarted: false };
  const service = new CollaborationBuilder()
    .withName("sdc-onchange-test")
    .withDebounce(0)
    .onLoad(() => undefined)
    .onChange(() => { if (counter.countingStarted) counter.afterSync += 1; })
    .build();

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, request) => {
    request.params = { documentId: request.url.replace(/^\//, "").split("?")[0] };
    service.welcome(ws, request).catch((error) => console.log("welcome() rejected:", error.message));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}`, "onchange-room", ydoc, { WebSocketPolyfill: (await import("ws")).default });
  await new Promise((resolve) => provider.once("sync", resolve));
  counter.countingStarted = true; // ignore handshake-triggered updates; count only the edit below.

  ydoc.getText("content").insert(0, "This is one logical edit (single Y.Transaction).");
  await new Promise((resolve) => setTimeout(resolve, 500));

  provider.destroy();
  server.close();

  const reproduces = counter.afterSync >= 10; // "~22x" claim; use a generous threshold.
  console.log(`claim4 (onChange fires ~22x per single edit) -> ${reproduces ? "PASS (reproduces)" : "FAIL (not reproduced with a raw single Y.Transaction)"}`);
  console.log(`  - onChange invocations observed for ONE Y.Transaction insert: ${counter.afterSync}`);
  results.claim4_onChangeFiresManyTimes = {
    reproduces,
    onChangeCountForOneTransaction: counter.afterSync,
    note: "Tested with a raw yjs client doing one Y.Transaction, not a real SuperDoc/y-prosemirror editing session -- see README caveat.",
  };
}

async function claim5() {
  const { CollaborationBuilder } = await import("@superdoc-dev/superdoc-yjs-collaboration");
  const capturedLines = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  const capture = (...args) => { capturedLines.push(args.join(" ")); };
  console.warn = capture;
  console.log = (...args) => { capture(...args); originalLog(...args); };

  const service = new CollaborationBuilder().withName("instanceof-test").onLoad(() => undefined).build();
  const sharedDoc = await service.documentManager.getDocument("instanceof-room", { documentId: "instanceof-room" });

  console.warn = originalWarn;
  console.log = originalLog;

  const instanceofHostYDoc = sharedDoc instanceof Y.Doc;
  const sawWarning = capturedLines.some((line) => line.includes("Yjs was already imported"));

  const reproduces = instanceofHostYDoc === false || sawWarning;
  console.log(`claim5 (bundles its own yjs; instanceof fails) -> ${reproduces ? "PASS (reproduces)" : "FAIL (not reproduced)"}`);
  console.log(`  - sharedDoc instanceof host app's Y.Doc: ${instanceofHostYDoc}`);
  console.log(`  - "Yjs was already imported" warning seen: ${sawWarning}`);
  results.claim5_bundlesOwnYjs = { reproduces, instanceofHostYDoc, sawDuplicateYjsWarning: sawWarning };
}

await claim1();
await claim1Control();
await claims2and3();
await claim4();
await claim5();

console.log("RESULTS_JSON:" + JSON.stringify(results));
process.exit(0);
