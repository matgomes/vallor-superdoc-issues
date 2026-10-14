# SuperDoc repro harness

Bare-SuperDoc reproduction harness for bug reports filed with the SuperDoc vendor. No Vallor
application code — every repro mounts `superdoc` / `@superdoc/sdk` directly, pinned exactly:

- `superdoc` 2.23.0
- `@superdoc/sdk` 2.20.0
- `@hocuspocus/server` 2.15.3 (4.x has an incompatible API)
- `vite` 8.3.4, `playwright` 1.64.0, `yjs` 13.6.33, `jszip` 3.10.2

## Setup

```bash
npm run setup   # npm i && npx playwright install chromium
```

## Layout

- `harness/index.html` + `harness/main.js` — the Vite page every browser-based repro loads. Mounts
  `new SuperDoc(...)` on a full-size container and reads its config from the URL query string.
- `harness/lib/browser.mjs` — Playwright-side helpers: start Vite, launch Chromium, open a doc and
  wait for it to be ready, screenshot, read errors, install timing probes, and call into
  `window.__sd` (doc API, export).
- `harness/lib/collab-server.mjs` — start a bare, in-memory Hocuspocus server and seed a
  collaboration room from a `.docx`.
- `harness/lib/sdk.mjs` — headless `@superdoc/sdk` helpers: open/close a doc, export to `.docx`,
  count OOXML tags in the result via `jszip`.
- `_example/` — a smoke-tested example repro. Copy its shape for a new `SD-xx/` folder at the repo
  root (its own `repro.mjs` plus any fixture `.docx` files).

Run a repro with `node SD-xx/repro.mjs` (or `node _example/repro.mjs`).

## `harness/index.html` query parameters

| Param | Values | Notes |
|---|---|---|
| `doc` | path to a `.docx` | Served from the repo root, e.g. `doc=SD-12/fixture.docx`. Omit for a plain collaboration-only room with no local seed. |
| `mode` | `editing` \| `suggesting` \| `viewing` | Default `editing`. |
| `user` | display name | Default `Probe`. Also derives a `name@example.com` email. |
| `collab` | `<serverUrl>,<documentId>,<roomMode>` | Optional. `roomMode` is `create` or `join`. Enables Hocuspocus collaboration. |
| `commentsDisplay` | `inline` \| `sidebar` | Optional. Maps to `ui.comments.layout`. |
| `licenseKey` | license key string | Optional. Falls back to the `VITE_SUPERDOC_LICENSE_KEY` env var, then runs unlicensed. |

The page exposes `window.__sd` (the `SuperDoc` instance), `window.__ready` (a promise that
resolves once `onReady` fires), `window.__errors` (an array collecting `onException` payloads,
uncaught `window.error`/`unhandledrejection` events, and `console.error` calls), and `window.__ui`
(set once `window.__ready` resolves — the reactive ui facade from `createSuperDocUI({ superdoc })`,
i.e. `ui.comments`/`ui.trackChanges` with `getSnapshot()`, `list()`, `setActive()`, `reply()`, etc.
This is a separate controller object; `window.__sd.activeEditor.ui` does not exist on its own).

## `harness/lib/browser.mjs`

- `startServer()` — spawns Vite rooted at the repo root. Returns `{ url, stop() }`.
- `launchBrowser()` — launches Chromium. Headless by default; set `HEADFUL=1` to watch it run.
- `openDoc(browser, baseUrl, queryParams, options)` — opens `harness/index.html` with the given
  query params, brings the page to front, and waits for `window.__ready` (default 60s timeout,
  override with `options.timeoutMs`). Returns the Playwright `Page`.
- `readErrors(page)` — returns `window.__errors`.
- `screenshot(page, outDir, name)` — writes a screenshot into the calling repro's own folder.
- `installTimingObservers(page)` / `readTiming(page)` — records per-frame duration (via `rAF`),
  Long Tasks, and Long Animation Frame entries into `window.__timing`.
- `jsHeapMB(page)` — current JS heap usage in MB, via CDP `Runtime.getHeapUsage`.
- `evalSd(page, fn, ...args)` — thin wrapper over `page.evaluate` for arbitrary `window.__sd` /
  `window.__ui` / commands access.
- `callDoc(page, "trackChanges.list", ...args)` — calls a dotted method path on
  `window.__sd.activeEditor.doc`, e.g. `callDoc(page, "trackChanges.decide", { target: { kind: "all" }, decision: "accept" })`.
- `exportDocx(page, exportOptions)` — calls `window.__sd.export({ exportType: ["docx"], triggerDownload: false, ...exportOptions })` and returns a `Buffer`. Pass `{ isFinalDoc: true }` for the "final" export.

## `harness/lib/collab-server.mjs`

- `getFreePort()` — an available TCP port.
- `startCollabServer(options)` — starts a bare `@hocuspocus/server` (in-memory, no persistence
  extension, no auth). Returns `{ port, url, stop() }`.
- `seedRoomFromDocx(serverUrl, documentId, docPath, options)` — opens `docPath` headlessly via
  `@superdoc/sdk` with `roomMode: "create"`. Returns `{ document, release() }`.

**Keep the seed connection open until every joiner is done.** A bare Hocuspocus server has no
persistence extension, so a room only exists in memory while at least one client is connected to
it — closing the seeding connection (even with `unloadImmediately: false`) can make the room
disappear before a later `roomMode: "join"` finds it. Call `release()` only after the last joiner
has finished:

```js
const collab = await startCollabServer();
const seed = await seedRoomFromDocx(collab.url, documentId, fixturePath);
// ... open joiners (browser `collab=` query param, or `openDocx` with `collaboration: { roomMode: "join" }`) ...
await seed.release();
collab.stop();
```

## `harness/lib/sdk.mjs`

- `openDocx(docPath, options)` — opens a `.docx` via `@superdoc/sdk` (`createSuperDocClient({ runtime: "v2" })`). Pass `options.collaboration` (e.g. `{ url, documentId, roomMode: "join" }`) to join a room started with `collab-server.mjs`. Returns `{ client, document }`.
- `closeDocx({ client, document }, options)` — closes the document and disposes the client. Defaults to `{ discard: true }`.
- `exportDocx(document, mode)` — calls `document.export.toDocx({ mode })` (`"original"` \| `"review-preserving"` \| `"final"`). Returns `{ buffer, warnings }`.
- `countTags(docxBuffer, tags)` — unzips `word/document.xml` and counts occurrences of each tag, e.g. `countTags(buffer, ["w:ins", "w:del", "w:cellIns"])`.

Note the SDK's collaboration config uses `url`; the browser's `collab` query param (and
`harness/main.js`) uses `serverUrl` — these are two different config shapes for two different
runtimes, not a typo.

## Env vars

- `HEADFUL=1` — run Chromium with a visible window instead of headless.
- `VITE_SUPERDOC_LICENSE_KEY` — license key for `harness/main.js`; omit to run unlicensed.

## Comparing SuperDoc versions

The main install is pinned to the versions above. To compare behavior against another version,
install it into its own subfolder (not the repo root, so it never touches `package-lock.json`)
and point a Vite alias at it, e.g.:

```bash
mkdir -p SD-xx/sd-2.20.0 && (cd SD-xx/sd-2.20.0 && npm init -y && npm install superdoc@2.20.0)
```

```js
// SD-xx/vite.config.mjs
export default {
  root: import.meta.dirname,
  resolve: { alias: [{ find: "superdoc", replacement: resolvePath(import.meta.dirname, "sd-2.20.0/node_modules/superdoc") }] },
};
```

Then point `startServer()`-equivalent code at that config instead of the repo-root one. Only do
this when a repro specifically needs a version comparison — most bug reports just need the pinned
versions above.

## Recording helpers (optional query params)

| Param | Values | Effect |
|---|---|---|
| `label` | text | Caption in a small top-right overlay (e.g. `label=SD-09`). |
| `hud` | comma list of `fps`, `tc`, `err` | `fps`: live frame time, worst frame in the last 2 s, count of stalls over 500 ms. `tc`: live tracked-change and comment counts (polled every second through the doc API). `err`: the last `onException` / console error, so silent rejections are visible. |
| `actions` | `1` | A small "Accept all / Reject all" bar that calls `doc.trackChanges.decide({target:{kind:"all"}})` and prints the receipt, since a bare mount has no toolbar. |
