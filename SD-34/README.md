# SD-34 — Table structural-projection drift during collaborative saves (NEEDS REPRO)

## Summary

In production, after editing a table inside a live collaboration session, every subsequent
save/export can start failing with a `save-failed` error whose detail blames "table structural
projection span drift" — the engine can no longer resolve the table's current span inside its
internal projected document. When this happens the user can't save, re-analyse, delete, or undo a
contract, and the only recovery is reloading the editor. This matters for redlining: a stuck save
after a routine table edit (a very common clause-table pattern in contracts) blocks the whole
review workflow until the page is reloaded.

## Environment

- superdoc 2.23.0 / @superdoc/sdk 2.20.0 (this repo's pinned harness): **NEEDS REPRO** — the
  matrix below did not trigger the error via the headless SDK document API, in or out of a
  collaboration room.
- Prior versions: no isolated repro exists in our notes either (background is Sentry-only); this
  is the first dedicated repro attempt.

## Steps to reproduce

`node SD-34/repro.mjs` from the repo root. It runs this matrix against
`fixture-table-bearing-agreement.docx` (a clean table, no pre-existing tracked changes), both
**standalone** (no collaboration) and **in a v2 collaboration room** (bare Hocuspocus server):

| Case | What it does |
|---|---|
| A — one-shot cross-cell delete | `document.delete({ changeMode: "tracked", target: { kind: "selection", start: <text point in row-0/col-0 cell>, end: <text point in row-0/col-1 cell> } })` — a single tracked delete spanning two cells in one row. |
| B — sequential per-cell delete, then save | The same overall span deleted as two separate tracked `document.delete` calls, one scoped entirely inside cell A, then one entirely inside cell B — replaying the suspected workaround pattern one block at a time — followed by `document.export.toDocx({ mode: "review-preserving" })`. |
| C — edit / undo / redo, then save | A tracked `blocks.delete` of the first cell's paragraph, then `document.history.undo()`, then `document.history.redo()`, then another save attempt. |

UI equivalent: open a table-bearing document, select from inside one cell across into the next
cell and press Delete with Track Changes on; alternatively select the whole first cell's text and
delete it, then separately select and delete the whole second cell's text; then try to save.

## Expected / Actual

**Expected** (per the production report): at least one of these steps reproduces a `save-failed`
error whose message contains "table structural projection span drift" / "could not resolve the
current table span from the projected story", ideally only (or more easily) inside a room.

**Actual:**
- Case A (one-shot cross-cell tracked delete) **succeeded** via `document.delete` with a
  `kind:"selection"` target on 2.23.0/sdk 2.20.0, both standalone and in a room — it was not
  refused the way an earlier `blocks.deleteRange`-based cross-cell attempt was in prior testing
  (SD-09). This is a different API surface (`document.delete` with text-range `selection` target
  vs `blocks.deleteRange` with block addresses) and it now succeeds; see Related.
- Case B's two sequential per-cell deletes both succeeded (standalone and in-room); the standalone
  `export.toDocx` save then succeeded (`review-preserving`, 45529 bytes, no warnings). The in-room
  `export.toDocx` save failed, but only with `CAPABILITY_UNSUPPORTED: "The operation is
  unavailable while collaboration is active."` — the already-known SD-33 refusal of
  `export.toDocx` inside any collaboration session, not the table-structural-projection error, so
  it proves nothing by itself. The call that matters — `document.save({mode:"review-preserving"})`,
  the one save path SD-33 confirmed actually works in-room — **succeeded cleanly in-room too**
  (283,943 bytes, no warnings).
- Case C's edit/undo/redo sequence succeeded cleanly in both modes (undo removed the tracked
  delete, redo reinstated it, both reported `status: "applied"`); the standalone save succeeded;
  the in-room `export.toDocx` again hit the same SD-33 refusal, but in-room `document.save` again
  **succeeded cleanly** (283,698 bytes, no warnings).
- No `save-failed`, `V2EditorHostError`, "structural projection", or "projected story" text ever
  appeared in any case — on either save call, including the one (`document.save`) that is actually
  reachable from inside a live room in production. Full per-case output: `results-2.23.0.json`.

**Verdict: NEEDS REPRO on 2.23.0 / sdk 2.20.0** via the headless document API in or out of a room —
and this isn't masked by testing the wrong save call: the real in-room save path kept working.

## Browser attempt

The matrix above runs entirely through the headless `@superdoc/sdk`, which cannot reach the live
browser editor's own render/save pipeline. `browser-attempt.mjs` drives the real harness page
instead — a live `superdoc` instance, joined to a bare Hocuspocus room, in `suggesting` mode, on
this fixture — and performs the requested sequence through genuine UI interaction and the live
editor's own doc API in the same session:

1. Attempted a cross-cell selection + Backspace through real mouse/keyboard interaction (scroll the
   row-0 cell pair into a genuinely painted state — this renderer is virtualized/windowed with no
   semantic `<table>`/`<td>` DOM, so a plain CSS locator finds nothing — then click, shift-click,
   Backspace). This succeeded in locating and acting on real painted text, but landing precisely on
   the two target cells inside this fixture's 11-page layout was not fully reliable within the
   time-box; see the caveat below.
2. Replayed the sequential per-cell tracked delete (row 1) via `callDoc(page, "delete", ...)` —
   the live editor's own doc API, in the browser, inside the room (not the headless SDK).
3. Undo/redo twice each via real `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` keyboard shortcuts.
4. Typed real keyboard input at the live caret position.
5. Called `window.__sd.export({exportType:["docx"], triggerDownload:false})` — succeeded, 42,842
   bytes.
6. Discovered and called `window.__sd.save()` — a save-shaped method on the browser `SuperDoc`
   instance itself (distinct from `.export()`; found by enumerating `window.__sd`'s own and
   prototype keys for `/save|persist|sync|collab/i`, alongside `getCollaborationConnectionState`
   and `upgradeToCollaboration`). This is the closest thing to "the live editor's save path"
   reachable from this harness. Raced against a 15s timeout: **resolved**, no hang, no throw.

**Result: no `save-failed` / `V2EditorHostError` / "structural projection" / "projected story" text
appeared at any of the 7 recorded steps** (`window.__errors` stayed empty throughout — see
`browser-attempt-results.json`). This confirms the NEEDS REPRO verdict through the live browser
editor and its own save method too, not just the headless SDK.

**Caveat:** step 1's literal "select 2-3 cells with a pointer and press Backspace" did not
reliably land on the intended table cells specifically — this fixture's table sits deep inside an
11-page document with no stable DOM anchor for mouse targeting in this virtualized renderer, and
locating it by scrolling/text-matching within the time-box was inconsistent run to run. Step 2
(the per-cell delete replay — the specific suspected trigger pattern) did reliably and
verifiably target the real table cells, in the browser, in the room, which is the
methodologically important half of this request. Screenshots: `screenshots/00` through `06`.

## Evidence

Full raw results: `results-2.23.0.json`. Key excerpt — in-room save outcomes for Case B / Case C
(both calls attempted after each case; `exportToDocx` is the always-refused SD-33 call, kept for
the record; `documentSave` is the one that matters):

```json
{
  "exportToDocx": { "ok": false, "error": "CAPABILITY_UNSUPPORTED: The operation is unavailable while collaboration is active." },
  "documentSave": { "ok": true, "byteLength": 283943, "warnings": [] }
}
```

## Root cause / analysis

**Methodological note:** an earlier pass of this repro used only `document.export.toDocx(...)` as
the post-trigger save check, which throws `CAPABILITY_UNSUPPORTED` unconditionally inside any
collaboration session on this SDK version (SD-33) — so it could never have reached the code path
that would surface a table-structural-projection failure while joined to a room, whether or not
one occurred. Re-run using `document.save({mode:"review-preserving"})` instead (the call SD-33
confirmed is the real, working in-room save path) and it succeeds cleanly after both Case B and
Case C, in-room. So the negative result here isn't an artifact of an always-broken save check —
the one save path actually reachable from inside a room in production genuinely kept working
across this matrix. Whatever "save" means in the original report (a `v2-editor-host: save-failed`
error, which per static analysis of the installed bundle is thrown by a `V2EditorHostError` class
living in `@superdoc/docx-engine`'s runtime and in the browser-side `createSuperDocUI` chunk — not
in the headless SDK's `document-api`), it may still be a **live browser editor autosave/sync
pipeline** distinct from both `export.toDocx` and the SDK's `document.save` — that pipeline is
reachable from the browser harness via the newly-added `window.__ui` facade, which this repro did
not exercise — see Suggested fix / follow-up.

Static analysis of the installed `@superdoc/docx-engine` bundle also confirms the
`projection-session-sync-failed` code path is real and present on this version: a collaboration
"barrier" validator (internally keyed `story-surface-backend:session-sync` with a
`:table-structural` variant) runs on each synced change and, on failure, attaches a
`{code: "projection-session-sync-failed", severity: "hard", message: <validator message>}`
diagnostic. This is consistent with SD-34 and SD-35 sharing one underlying barrier/validator
mechanism, with "table structural projection span drift" being the human-readable message a
table-structural validator run produces when it fails — a hypothesis, not confirmed by a live
repro.

## Suggested fix

The table-structural session-sync barrier (`story-surface-backend:session-sync:table-structural` in
the installed `@superdoc/docx-engine` bundle) is the most likely owner of this failure class —
worth instrumenting/logging in a debug build to see what "projected story" state it compares
against the live table structure, and under what edit sequences the two diverge. For us: a
follow-up repro should drive the actual **browser** editor (not the headless SDK) in a
collaboration room, perform the same edit matrix through the UI/`window.__ui`/`callDoc` surface so
the live autosave path actually runs, and — since the production report mentions "the shared room
stays healthy" (only one client's local state goes bad) — try the matrix with **two concurrent
joiners** editing the same table, not a single joiner, since CRDT/projection drift is more
plausible as a divergence between one client's locally cached projection and the server-merged
Yjs state than as a single-client-only bug.

**Possible workaround:** none identified from this repro (nothing failed to produce one).

## Related

SD-33 (export.toDocx is refused inside any collaboration session — the same refusal masked every
in-room "save" attempt here), SD-35 (shares the `projection-session-sync-failed` diagnostic code
and the same session-sync barrier mechanism), SD-09 (prior cross-cell tracked-delete refusal via a
different, block-address-based API — not reproduced via the text-selection `document.delete` API
used here).
