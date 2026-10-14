# SD-38 — `bookmarks.get()` on a missing bookmark: `TARGET_NOT_FOUND` nested inside a generic `WorkerTransportError` (browser only)

## Summary
`bookmarks.get()` on a nonexistent bookmark rejects rather than resolving `null`, which is
expected and fine. In the browser, though, the real engine error code
(`TARGET_NOT_FOUND`) is nested one level down inside a generic transport wrapper
(`WorkerTransportError`, `code: "execution-error"`, `reason: "TARGET_NOT_FOUND"`) — a
caller that only checks the top-level `error.code` sees the same generic
`"execution-error"` for every engine-side refusal, not just a missing bookmark. The
headless Node SDK, which uses a different transport (a CLI child process, not a browser
worker), reports a clean top-level `code: "TARGET_NOT_FOUND"` for the identical call.

## Environment
- **2.23.0** (this report): **reproduces in the browser**; does **not** occur in the
  headless `@superdoc/sdk` (clean top-level code there).
- `@superdoc/sdk` 2.20.0.

## Steps to reproduce
1. Open any document (`_fixtures/bookmark-x1-plain.docx`).
2. Call `doc.bookmarks.get({ target: { kind: "entity", entityType: "bookmark", name:
   "definitely-does-not-exist" } })`.
3. In a bare `new SuperDoc(...)` mount (browser, `window.__sd.activeEditor.doc`), inspect
   the caught error's `constructor.name`, `name`, `code`, and `reason`.
4. Repeat the identical call through the headless `@superdoc/sdk` (`createSuperDocClient`)
   and compare.

`node SD-38/repro.mjs`.

## Expected / Actual
- **Expected:** either a clean rejection with a top-level, specific error code in both
  environments, or a resolved `null`.
- **Actual:**
  - **Browser:** rejects with `{ name: "WorkerTransportError", code: "execution-error",
    reason: "TARGET_NOT_FOUND", message: 'bookmarks.get: bookmark
    "definitely-does-not-exist" was not found.' }` — the actionable code is `reason`, one
    level down, not `code`.
  - **Headless SDK:** rejects with `{ name: "SuperDocCliError", code: "TARGET_NOT_FOUND",
    message: '...' }` — clean, top-level, immediately actionable.

## Evidence
`repro.mjs` → `results-2.23.0.json`.

## Root cause / analysis
The browser's docx-engine runs inside a Web Worker; every error that crosses that
boundary is marshalled through a shared `WorkerTransportError` class (confirmed in
`node_modules/@superdoc/docx-engine/dist/docx-engine.es.js`: `class extends Error {
constructor(s) { ...; this.name = 'WorkerTransportError'; this.code = s.code; this.reason
= s.reason; ...} }`) that carries `code: "execution-error"` for *any* engine-side failure
and puts the real, specific engine error code under `reason`. The headless SDK instead
runs the engine in a separate CLI process and maps its JSON-RPC error directly to a
`SuperDocCliError` with the real code already at the top level — a structurally different,
cleaner transport for the same underlying engine call.

## Suggested fix
Either flatten `WorkerTransportError` so the specific engine code is always the top-level
`code` (reserving `reason`/`details` for extra context, as the CLI transport already
does), or document the nested-`reason` shape clearly so integrators know to check both.

## Possible workaround
A guard that accepts either the top-level `code` or a nested `.reason` as the real engine
code, so the same check works across both transports.

## Related
None additional.
