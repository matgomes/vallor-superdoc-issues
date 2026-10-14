# SD-35 — Collaboration save barrier (`projection-session-sync-failed`) could not be triggered on 2.23.0; three previously-refused edits now succeed in a room

**Summary:** Production reports describe a collaboration session that permanently stops saving
after one specific edit is rejected with "This edit couldn't be completed. Adjust the selection
and try again" — subsequent saves fail with a `projection-session-sync-failed` diagnostic until a
full reload. On superdoc 2.23.0 / `@superdoc/sdk` 2.20.0, none of the three edit types known (from
prior testing on earlier versions) to be refused inside a collaboration room could be made to
refuse at all: a cross-cell tracked delete, a whole-paragraph tracked delete, and a tracked-mode
list conversion all now **succeed** in a live room. Without a refused edit to trigger the
downstream desync, the save-barrier failure itself could not be exercised — and this isn't just
an artifact of testing the wrong call: after every trigger, `document.save({mode:"review-preserving"})`
(the one save path SD-33 found actually works from inside a live room; `export.toDocx` is refused
unconditionally regardless of history, per SD-33, so it proves nothing either way) **succeeded
cleanly** every time, with no warnings. This matters to end users because, per the background
reports, when the desync does occur it silently blocks all further saving/export of in-progress
contract redlines until the page is reloaded — a near-data-loss condition for unsaved review work.

**Environment:**
- superdoc 2.23.0 / `@superdoc/sdk` 2.20.0: **NEEDS REPRO** — see below.
- Earlier versions (sdk 2.16 → 2.18+, per prior production reports): reported blocking in
  production; no standalone repro existed from that era either (Sentry-only).
- Bare `@superdoc/sdk` (`createSuperDocClient({ runtime: "v2" })`), Node 24, no browser involved —
  this is a pure document-API / collaboration-engine repro attempt.

**Steps to reproduce:**

UI-equivalent steps (what a user does, as reported in production): open a document in a shared
collaboration room; make an edit the engine refuses (e.g. deleting a selection that crosses two
table cells, or converting a paragraph to a list while another participant is mid-edit); after
seeing "This edit couldn't be completed. Adjust the selection and try again," make any further
edit and try to save — the save silently fails from then on.

Script form, run from the repo root:

```
node SD-35/repro.mjs
```

The script, for each of three trigger candidates, in its own fresh collaboration room (seeded via
`harness/lib/collab-server.mjs`, joined via `harness/lib/sdk.mjs`'s `openDocx` with
`collaboration: { roomMode: "join" }`):
1. **cross-cell-delete** — `document.delete()` with a `selection` target spanning the first two
   cells of row 0 of `fixture-table-bearing.docx`'s table, `changeMode: "tracked"`.
2. **whole-paragraph-delete** — `document.blocks.delete()` targeting an entire paragraph block in
   `fixture-plain-paragraphs.docx`, `changeMode: "tracked"`.
3. **list-conversion** — `document.lists.create({ mode: "fromParagraphs", ... })` on a plain
   paragraph in the same fixture, `changeMode: "tracked"`, inside the room.

After each trigger, the script attempts a benign tracked insert elsewhere in the document, then
calls both `document.export.toDocx({ mode: "review-preserving" })` (always refused in any
collaboration session per SD-33, kept only for the record) and `document.save({ mode:
"review-preserving", out, force: true })` (the real save path, confirmed working in-room by
SD-33) and records both outcomes.

**Expected:** at least one of the three triggers reproduces a refused edit carrying the "This edit
couldn't be completed..." family of errors, after which the benign follow-up edit and/or the
`document.save()` attempt fails with a `projection-session-sync-failed` / "save barrier"
diagnostic.

**Actual:** all three triggers **succeeded** (`success: true`, each produced a real tracked
change — see `results-2.23.0.json`). The subsequent benign insert also succeeded in all three
cases. `document.export.toDocx` failed identically after every trigger (and, per separate
testing, even with no trigger at all) with the same `CAPABILITY_UNSUPPORTED`/`COLLABORATION_ACTIVE`
error SD-33 already filed — that's not evidence either way. But `document.save({mode:
"review-preserving"})` — the call that actually matters, since it's the one real save path
reachable from inside a room — **succeeded cleanly after every trigger**, writing a real `.docx`
each time with zero warnings:

```json
{ "crossCellDelete": { "ok": true, "byteLength": 284605, "warnings": [] },
  "wholeParagraphDelete": { "ok": true, "byteLength": 3533, "warnings": [] },
  "listConversion": { "ok": true, "byteLength": 5156, "warnings": [] } }
```

No `projection-session-sync-failed` diagnostic, nor any other error, appeared anywhere in the
matrix — on the one save call that is actually exercised in production.

**Browser attempt:** the matrix above runs entirely through the headless `@superdoc/sdk`, which
cannot reach the live browser editor's own render/save pipeline. `browser-attempt.mjs` drives the
real harness page instead — a live `superdoc` instance, joined to a bare Hocuspocus room, in
`suggesting` mode, on this fixture — and keeps editing and saving in the same room after trigger
(a), as requested:

1. Triggered the cross-cell delete (the known refusal class behind "This edit couldn't be
   completed...") through genuine mouse/keyboard interaction — scrolled the row-0 cell pair into a
   painted state (this renderer is virtualized/windowed with no semantic `<table>`/`<td>` DOM) then
   clicked, shift-clicked, and pressed Backspace. Locating the exact two target cells reliably
   within the time-box was inconsistent run to run in this fixture's 11-page layout (see caveat).
2. Kept editing in the same live room: replayed a per-cell tracked delete (row 1) via
   `callDoc(page, "delete", ...)` (the live editor's own doc API, in the browser), undo/redo twice
   each via real keyboard shortcuts, and typed real keyboard input.
3. Kept saving in the same room: called `window.__sd.export(...)` (succeeded, 42,840 bytes), then
   discovered and called `window.__sd.save()` — a save-shaped method on the browser `SuperDoc`
   instance itself, distinct from `.export()` (found by enumerating `window.__sd`'s keys for
   `/save|persist|sync|collab/i`) — **resolved** cleanly (no hang, no throw), raced against a 15s
   timeout.
4. Made a second benign edit and called `window.__sd.save()` again, to check for a *permanent*
   desync specifically (not just a transient one): **also resolved cleanly.**

**Result: no `save-failed` / `projection-session-sync-failed` / "save barrier" text appeared at
any of the 9 recorded steps** (`window.__errors` stayed empty throughout — see
`browser-attempt-results.json`). This confirms NEEDS REPRO through the live browser editor and its
own save method too, including a second save round-trip to rule out a desync that only shows up
after the first one. **Caveat:** step 1's literal pointer-based cell targeting was not fully
reliable (see the same caveat in SD-34, which shares this fixture and renderer); step 2's per-cell
replay (the specific suspected trigger pattern, from the live editor's doc API, in the room) did
reliably target the real table cells, which is the methodologically important half of this
request. Screenshots: `screenshots/00` through `08`.

**Evidence:**
- `results-2.23.0.json` — full machine-readable output: all three `deleteResult`/`createResult`
  entries `ok: true` with real `trackedChangeRefs`; all three `benignInsert` entries `ok: true`;
  all three `saveAfter.documentSave` entries succeed cleanly (shown above); `saveAfter.exportToDocx`
  fails identically every time with the unrelated SD-33 refusal.
- The installed `@superdoc/docx-engine` package **does** contain the `projection-session-sync-failed`
  diagnostic code, in both `dist/collaboration-upgrade-engine.js` and `dist/collaboration-worker.js`
  (minified). In both files it is produced by the same pattern: after an internal
  `runBarrier(...)` call returns a `record`, a validator function runs against that record; when
  the validator reports `ok: false`, the code appends a diagnostic
  `{ code: 'projection-session-sync-failed', severity: 'hard', message: <validator message> }` and
  sets `status: 'failed'`. This confirms the diagnostic is a real, present code path in the bare
  engine — not something that only exists in an integrator's wrapper — but it lives behind an
  internal checkpoint/barrier step that the public `document.export.toDocx` call never reaches (it
  fails immediately on the `COLLABORATION_ACTIVE` check, before any barrier/checkpoint runs).

**Root cause / analysis:** One confirmed gap, one ruled out:
1. **Trigger gap (confirmed):** the three edit types previously known (SD-09-style cross-cell
   delete, SD-10-style whole-paragraph delete, and a list conversion while collaboration is
   active) to be *refused* in a room appear to have been fixed for acceptance — on 2.23.0 all
   three are accepted and produce real tracked changes. Whatever specific condition production
   users hit to get "This edit couldn't be completed. Adjust the selection and try again" was not
   reproduced by any of these three candidates on this version.
2. **Observation gap (ruled out):** an earlier pass of this repro only tried `document.export.toDocx`
   as the post-trigger save check, which is refused unconditionally in any collaboration session
   regardless of edit history (SD-33) — so it couldn't have distinguished a healthy room from a
   desynced one either way. Re-run using `document.save({mode:"review-preserving"})` instead (the
   call SD-33 confirmed is the real, working in-room save path) and it succeeds cleanly after
   every trigger. So the negative result isn't an artifact of testing an always-broken call — the
   one save path that's actually reachable in production genuinely kept working. The
   `runBarrier`/validator code path that emits `projection-session-sync-failed` is confirmed
   present in the engine (see Evidence above) but was not invoked by anything exercised here; it
   is plausibly only reached through a narrower condition than any of these three triggers alone
   (e.g. requiring a second concurrent participant, a specific mid-flight timing window, or a
   checkpoint/persistence step this bare harness has no public API to force directly).

**Suggested fix:** as analysis — exposing the barrier/checkpoint call (and its validator) through
the public collaboration API (or at least through a documented diagnostic hook) would let
integrators reproduce and detect this condition directly, rather than only being able to infer it
indirectly through failed saves downstream. Possible workaround for an integrator: treat the
engine's generic in-room save refusal defensively (retry with backoff, and force a full
room rejoin after any edit refusal) rather than assuming a transient failure, since there is no
public signal to distinguish "refused because of `COLLABORATION_ACTIVE`" from "refused because of
a desynced checkpoint."

**Related:** SD-33 (export unconditionally refused in collaboration — the refusal observed in every
cell of this matrix), SD-34 (a different suspected table-structural desync, also try-to-reproduce,
also not triggered by matching edit sequences on 2.23.0), SD-09/SD-10 (the prior cross-cell /
whole-paragraph refusal reports that no longer refuse on this version).
