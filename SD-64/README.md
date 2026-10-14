# SD-64 — `@superdoc-dev/superdoc-yjs-collaboration` library defects

## Summary
`@superdoc-dev/superdoc-yjs-collaboration` (the quick-start collaboration server SuperDoc
publishes for integrators) has several defects that make its own README example
unrunnable, make every connection crash-prone against the most common minimal server
setup, and make it unsafe to combine with a host's own `yjs` installation. Checked the
latest published version — still **1.0.2**, same version the original findings were based
on (`npm install @superdoc-dev/superdoc-yjs-collaboration@latest` resolves 1.0.2).

## Environment
`@superdoc-dev/superdoc-yjs-collaboration@1.0.2` (latest, installed in `SD-64/scratch/`,
not added to the repo root), Node 24, isolated from the main harness.

## Findings (5 sub-claims, independently verified)

### 1. README quick-start example is unrunnable — REPRODUCES (worse than previously recorded)
The README's own example does `import SuperDocCollaboration from
'@superdoc-dev/superdoc-yjs-collaboration'` (a **default** import) then
`new SuperDocCollaboration().withName(...)`. The package has **no default export** —
`dist/index.d.ts` only exports named `CollaborationBuilder`, `SuperDocCollaboration`
(a class requiring a `ServiceConfig` constructor argument, with no builder methods at
all), and types. Two concrete, verified crash modes:
  - Plain Node ESM (`node script.mjs`): a hard `SyntaxError` at module-load time —
    *"The requested module '@superdoc-dev/superdoc-yjs-collaboration' does not provide an
    export named 'default'"* — the script never even starts running.
  - Plain Node CJS (`require(...)`): `require()` returns the whole exports object
    (`{CollaborationBuilder, SuperDocCollaboration}`), not a class, so `new
    SuperDocCollaboration()` throws `TypeError: SuperDocCollaboration is not a
    constructor`.
  - (Earlier research recorded a different error, `TypeError: ... reading 'hooks'`,
    presumably from a bundler/transpiler context with looser default-import interop that
    produces `undefined` instead of throwing immediately — we did not reproduce that exact
    variant, but the underlying cause — the example importing a default export that does
    not exist — is the same, and is unambiguously broken under plain Node either way.)
  - The two real classes: `CollaborationBuilder` (the fluent builder with `.withName()`
    etc., matching the README's own "API Reference" table further down the same page) and
    `SuperDocCollaboration(config: ServiceConfig)` (takes config directly, no builder
    methods) — the README's own reference table contradicts its own quick-start example.

### 2. `generateParams` requires Express/Fastify-style `request.params` — REPRODUCES
`generateParams` (confirmed by reading `dist/index.cjs`) does
`const params2 = request.params ?? {}; const { documentId, ...rest } = params2; if
(!documentId) throw new Error('Collaboration request missing required "documentId"
param');`. A raw `node:http` `IncomingMessage` has no `.params` (that's an Express/Fastify
route-param convenience the library assumes every host provides). Verified live: calling
`service.welcome(socket, { url, headers })` with no `.params` field throws exactly that
error for every single connection attempt.

### 3. `welcome()` rejects asynchronously and unhandled — REPRODUCES
`welcome()` is declared `async` (`Promise<void>`). The README's own example calls it
fire-and-forget, with no `await`/`.catch()`:
`app.get('/collaboration/:documentId', {websocket:true}, (socket, request) =>
service.welcome(socket, request));`. Verified live: calling `welcome()` exactly that way
(no await) with the same raw-http request from finding #2 produces an **unhandled
promise rejection** a moment later — caught only because our test script installed a
`process.on('unhandledRejection', ...)` handler. Node's default behavior (since Node 15)
for an unhandled rejection with no handler is to crash the process — so any connection
that fails inside `welcome()` for any reason (this one, or a failed `onAuthenticate`/
`onLoad` hook) can take the whole server down if the host app doesn't register a global
handler, which the README's own example does not.

### 4. `onChange` firing ~22× per edit — NOT REPRODUCED (narrow test; needs a full integration test)
The hook wiring itself (confirmed by reading the bundle) is a single
`sharedDoc.on("update", (...) => hooks.change?.(...))` registered once per connection
inside `welcome()` — one call per Yjs `update` event, which is the correct, expected
mapping. In an isolated test (a bare `doc.getText("default").insert(...)` inside one
`doc.transact(...)` on a connection established via `welcome()`), the hook fired exactly
**once**. We could not reproduce a ~22× fan-out at this library's level. The original
~22×-per-edit number most likely reflects how many separate Yjs transactions a live
SuperDoc v2 editor session generates internally for one user-facing edit (e.g. text +
selection/awareness + formatting-mark sub-updates), not a defect in this package's hook
wiring — but confirming that precisely would require a full bare-SuperDoc-editor +
real collaboration-room integration test, which is out of scope for this isolated
package-level repro.

### 5. Bundles its own `yjs`; `instanceof` fails against a host's `yjs` — REPRODUCES, with a worse practical consequence than "just instanceof"
`dist/index.cjs`/`dist/index.js` (242 KB / 241 KB) have no `yjs` entry in
`dependencies`/`peerDependencies` at all — `yjs`/`y-protocols` are inlined into the bundle
by its `tsup` build. Loading the package alongside a host's own `yjs` (as this harness
does, `yjs@13.6.33` at the repo root) immediately prints Yjs's own guard warning: *"Yjs was
already imported. This breaks constructor checks and will lead to issues!"*
(`github.com/yjs/yjs/issues/438`). Verified concretely:
  - A document created through this package (`SharedSuperDoc extends Doc`) is **not**
    `instanceof` the host's own `yjs`'s `Doc` class (`false`).
  - Worse: constructing content with the **host's** `yjs` (`new Y.XmlText()`, exactly what
    an integrator would naturally do, since the package doesn't re-export any Yjs types
    for building compatible content) and inserting it into the package's document
    **throws at runtime** — `Error: Unexpected content type in insert operation` — because
    the package's internal type-check rejects content built from a different `Doc`
    "universe." A host cannot safely construct Yjs content for this package's documents
    using its own `yjs` installation at all; only plain string/primitive operations
    (`doc.getText(name).insert(index, string)`) work across the boundary.

## Evidence
All five sub-claims verified live in `SD-64/scratch/` (not committed as a single
`repro.mjs` since each is a standalone script against the npm package directly, not the
shared harness): `test-readme-example.mjs`, `test-readme-example-cjs.cjs`,
`test-welcome.mjs`, `test-welcome-fireforget.mjs`, `test-bundled-yjs.mjs`,
`test-onchange-count3.mjs`. Representative output captured inline above; raw terminal
output available by re-running each script (`node SD-64/scratch/<script>.mjs`) after
`cd SD-64/scratch && npm install` there.

## Root cause / analysis
Covered per-claim above. In one sentence each: (1) README/API-reference mismatch —
example uses a default export that doesn't exist; (2) hardcoded Express/Fastify
assumption with no raw-`http`/other-framework fallback; (3) no internal `.catch()` on an
async hook chain the README itself calls unawaited; (4) likely not a defect in this
package, needs a broader test; (5) `tsup` bundles `yjs` instead of externalizing it as a
peer dependency.

## Suggested fix
(1) Fix the README example to import the real named exports (`CollaborationBuilder` or
`SuperDocCollaboration` with a config object), matching its own API reference table.
(2) Make `generateParams` tolerant of a `request.params` that doesn't exist — parse
`documentId` from the URL path itself as a fallback, rather than only from
framework-injected route params. (3) Wrap `welcome()`'s internal async work so a failure
always resolves (not rejects) with a logged error, or document loudly that callers must
`.catch()` it themselves. (5) Externalize `yjs`/`y-protocols` as peer dependencies instead
of bundling them, so a host application can share one `yjs` instance with this package.

## Related
None additional — this is a standalone vendor library, not part of the core SuperDoc
editor/engine.
