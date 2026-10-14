# SD-17 — A refused tracked-change decision is invisible to the integrator: no event, no exception, and the reactive list goes blank

## Summary

When a tracked-change decision is refused by the engine, SuperDoc's own public command
surface (`ui.trackChanges.accept()` / `acceptAll()` / their `Async` variants — the surface a
host application's own Accept/Reject buttons call) returns a typed failure receipt but raises
nothing else: no `onException`, no `console.error`, no thrown exception, no DOM-visible
message. Worse, the reactive `trackChanges` snapshot a host UI would bind its change list to
also collapses to an empty, unsettled (`status:"pending"`) list after the refusal, with no
diagnostic attached — a host UI reading only that snapshot would conclude every change was
resolved when in fact nothing was. For a contract-redlining product this means a legal reviewer
can believe every tracked change in a counterparty document has been accepted/rejected when the
underlying decision silently failed.

## Environment

- superdoc 2.23.0 / `@superdoc/sdk` 2.20.0 (per this repo's pinned `package.json`): **REPRODUCES**.
- 2.20.0 / 2.21.0: not independently re-tested for this specific command-surface angle (prior
  background notes recorded the underlying `decide({kind:"all"})` → `INVALID_INPUT` failure on
  these versions via the lower-level Document API, not via this public `ui.trackChanges`
  surface, which is new).
- Browser: Chromium via Playwright 1.64.0, headless. Node 22+. Bare SuperDoc mount (no custom
  toolbar/integrator UI) via this repo's `harness/`.

## Steps to reproduce

UI-shaped steps (what a user/integrator does):

1. Open a document containing a tracked paragraph-mark deletion whose mark has already been
   deleted twice by SuperDoc itself (a known defect — see SD-03/Related below; the fixture here
   has this shape pre-baked).
2. Click a host-app "Accept all changes" control (which, in any real integration, calls
   `ui.trackChanges.acceptAll()` / `acceptAllAsync()` — see "Root cause" for why this harness
   couldn't click a literal built-in button).
3. Observe: nothing happens in any error/console/exception channel. The only place the failure
   is visible at all is the return value of the call itself.

Script: `node SD-17/repro.mjs` (run from the repo root).

1. Opens `SD-17/fixture-paragraph-mark-deleted-twice.docx` in the bare harness, `mode:"suggesting"`.
2. **Control**: on a fresh load, accepts the single `paragraph-mark-deletion` change alone via
   `ui.trackChanges.acceptAsync(id)` — confirms single decisions succeed cleanly (`success:true`,
   zero errors), matching prior background notes ("single decisions still work").
3. On a second fresh load of the same fixture, calls `ui.trackChanges.acceptAllAsync()` — the
   bulk decision a host "Accept All" button would issue.
4. Reads `window.__errors` (captures `onException`, `window.error`, `unhandledrejection`, and
   `console.error`) immediately after the refusal, and again after waiting 1.5s while reading
   `ui.trackChanges.getSnapshot()`.

## Expected / Actual

**Expected:** a refused bulk decision either throws/rejects so a caller's own try/catch can
react, or at minimum raises an `onException` event / console diagnostic a host can log or
surface to the user; the reactive change-list snapshot should stay accurate (either unchanged,
or flagged with an error state) if the decision didn't apply.

**Actual:**

- `acceptAllAsync()` resolves (does not throw) with:
  ```json
  { "success": false, "failure": { "code": "INVALID_INPUT", "message": "invalid-input" } }
  ```
- `window.__errors` is `[]` both immediately after and 1.5s after the call — no `onException`,
  no `console.error`, no uncaught error/rejection of any kind.
- `ui.trackChanges.getSnapshot()` taken 1.5s after the refusal reports
  `{ "status": "pending", "items": [], "total": 0, ... }` — down from 2 items beforehand — and
  never settles back to `"ready"` within the observed window. Notably, SuperDoc's own built-in
  sidebar (driven by its internal state, not this facade) still correctly shows both unresolved
  changes at this point (see Evidence) — only the new public `ui.trackChanges` snapshot itself
  goes stale/empty. Any custom integrator UI built against this facade (rather than SuperDoc's
  own built-in rendering) would show "no tracked changes remaining" while the document still has
  two.

Full captured output: `results-2.23.0.json`.

## Evidence

- `results-2.23.0.json` — the exact receipts and error arrays described above.
- `screenshots/card-before.png` — the fixture loaded, tracked changes visible.
- `screenshots/card-after-refused-acceptall.png` — the page immediately after the refused
  `acceptAllAsync()` call: pixel-identical to `card-before.png`, no visible error, toast, or
  banner anywhere in the DOM, and SuperDoc's own sidebar still correctly lists both unresolved
  changes (contrast with the `ui.trackChanges` facade's own snapshot going to zero, above).
- Separately confirmed: the bare SuperDoc mount in this harness (no toolbar/custom chrome
  configured — see `harness/main.js`) renders only a passive, buttonless label card when a
  tracked-change mark is clicked (`<div class="tracked-change">...<span class="change-type">
  Deleted </span>...` — no `<button>` elements at all, in either `editing` or `suggesting`
  mode). This confirms Accept/Reject affordances are entirely integrator-built UI that must call
  `ui.trackChanges.accept()`/`acceptAll()` themselves — which makes this command surface's total
  silence on failure the *only* place in the whole stack where this information could have
  reached a user, and it doesn't.

## Root cause / analysis

- The underlying refusal is the known doubled-`<w:del/>` paragraph-mark defect (see SD-03):
  SuperDoc itself writes two `<w:del>` markers into one paragraph's `<w:pPr><w:rPr>` under a
  specific merge sequence, which OOXML permits only one of. `trackChanges.decide({kind:"all"})`
  then fails parse/validation for the *entire* document, including changes unrelated to the
  doubled marker. That part is SD-03's territory; SD-17 is specifically about what happens
  *after* that refusal is known to the engine.
- `ui.trackChanges.acceptAll()`/`acceptAllAsync()` (from `superdoc/ui`'s `createSuperDocUI`,
  the public v2-native UI controller) faithfully receives the Document API's failure and turns
  it into a `SuperDocUIFailureReceipt` (`{success:false, failure:{code,message}}` — see
  `node_modules/superdoc/dist/superdoc/src/public/ui/types.d.ts`). That receipt is a well-typed,
  reasonable API result. The bug is that nothing *upstream* of a caller who inspects that return
  value is told: the controller never also calls `onException`, never logs, never emits any
  subscribable event carrying the failure.
- Compounding this: the `trackChanges` reactive slice (`getSnapshot()`/`subscribe()`) that a host
  would bind its own change list/badge count to independently regresses to an empty, "pending"
  list after the failed bulk call and does not appear to recover within our observed window — even
  though SuperDoc's own built-in sidebar (which does not read this new facade) still shows the
  correct, unresolved count at the same moment. So a host that never reads `acceptAllAsync()`'s
  return value, and builds its own list/badge UI on this facade instead of SuperDoc's built-in
  rendering, has no correct signal either: its own list display goes to zero, which reads as "all
  done," not "failed."
- We could not drive a literal built-in "Accept"/"Reject" button for a single card in this bare
  harness because SuperDoc 2.23.0's own rendered tracked-change card has no such buttons without
  additional integrator-provided chrome (toolbar/sidebar) — the card is a passive label only (see
  Evidence). This means the "Couldn't accept this change." text reported in production comes
  from an integrator's own UI layer built on top of exactly this silent API, not from SuperDoc's
  stock card — which is itself useful context for the vendor: every integrator reimplementing
  decide-failure handling on top of this surface will hit the same silence.

## Suggested fix

Generic direction, as analysis (not a patch):

- Have `ui.trackChanges.accept()`/`reject()`/`acceptAll()`/`rejectAll()` (and their `Async`
  variants) route a failure receipt through the same `onException`-style channel `SuperDoc`
  already uses for other errors, in addition to returning it, so passive observers (logging,
  Sentry-style instrumentation) see it without every caller having to inspect every return value.
- Make the reactive `trackChanges` slice fail closed on a failed bulk decision — keep `items`/`total`
  reflecting the actual undecided changes (and/or add a `lastError` field to the slice) rather than
  draining to an empty, perpetually-`pending` list that implies success.
- Possible workaround: an integrator can wrap every `ui.trackChanges.*` call site itself, inspect
  `result.success`, and manually re-emit a diagnostic (log/toast/Sentry breadcrumb) — but this has
  to be done at every call site, and does nothing for the reactive snapshot's own silent emptying,
  which a host would need to separately reconcile against a fresh `list()`/`total` re-read.

## Manual check: SuperDoc's own floating card (2.23.0, Chrome)

On the same fixture, accepting changes one at a time from SuperDoc's built-in floating card **works**:
- accepting the "Deleted paragraph break" card resolves both duplicate paragraph-mark changes at once (`trackChanges.list().total` 3 → 1);
- accepting the remaining "Deleted …" card takes it to 0, and the document ends up clean.

So on 2.23.0 we could not make the card itself show a refusal with this document. The silent-refusal problem in this folder
is on the bulk path: `acceptAll` / `decide({kind:"all"})` refuses with `INVALID_INPUT`, and nothing reaches
`onException`, the console, or any event. Screenshot: `screenshots/manual-card-accept-paragraph-break-succeeded.jpg`.

## Related

- SD-03 (the doubled-`<w:del/>` paragraph-mark defect that causes the underlying `INVALID_INPUT`
  refusal used here as the trigger).
- SD-16 (`decide()` resolving on refusal instead of throwing — the same "fails closed but silent"
  shape, at the lower-level Document API rather than the `ui.trackChanges` controller).
- SD-18 (another `superdoc/ui`-adjacent preferences call that silently doesn't do what it claims).
