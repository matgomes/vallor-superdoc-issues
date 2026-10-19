# SuperDoc issues: reproductions

Issues we've hit integrating SuperDoc into a contract review and redlining product, each with a reproducible
`.docx`, a runnable script, and evidence. Every issue was re-checked on the **latest release**:

- **superdoc 2.23.0** / **@superdoc/sdk 2.20.0** (pinned in `package.json`)
- on a **bare `new SuperDoc(...)` mount**, with none of our application code. See `harness/`.

All documents are synthetic or anonymised: names, parties, places, numbers and authors are fictional, and the structure
that triggers each bug is preserved.

## Quick start

```bash
npm run setup                 # npm i + Playwright Chromium
node SD-105/repro.mjs         # any SD-xx/repro.mjs; prints PASS (bug reproduced) / FAIL and writes results-2.23.0.json
HEADFUL=1 node SD-06/repro.mjs   # watch it run
npx vite --port 5199          # then open http://localhost:5199/harness/index.html?doc=SD-06/whole-paragraph-deleted.docx&mode=suggesting
```

Each `SD-xx/` folder has a `README.md` covering the summary, environment, steps, expected vs actual, evidence, analysis,
suggested fix and related issues. Where an issue is visual or interaction-driven, a `MANUAL-STEPS.md` gives exact clicks.

## Urgent

- [**SD-105**](SD-105/): **documents with many tracked insertions freeze the editor.** A 12-page contract with a pasted schedule (1,629 `w:ins`) takes **13.7 s to scroll** (2.0 s once accepted), heap 122 → 351 MB, 42 long tasks; Backspace inside the tracked text takes ~6× longer; a synthetic 2,000-revision file reaches 8–34 s per scroll step and more than 1.1 GB. Includes CPU-profile analysis and fix directions. Measured on a MacBook M4; on the weaker machines our customers use, the editor becomes unusable and the browser tab crashes. Videos: [tracked](SD-105/video/SD-105-a.mp4), [accepted control](SD-105/video/SD-105-b.mp4).

## High

- [**superdoc/docx-editor#4047**](https://github.com/superdoc/docx-editor/issues/4047) (reported to SuperDoc): **Accept/Reject on a selection spanning two table cells does nothing** when only one of the cells holds a tracked change. The command returns `false`, the change stays pending, and no error is raised.
- [**superdoc/docx-editor#4058**](https://github.com/superdoc/docx-editor/issues/4058) (reported to SuperDoc): **comments created in SuperDoc have no creation date.** `comments.list()` returns no `createdTime`, and the exported `<w:comment>` has no `w:date`. This applies to the built-in composer and to `doc.comments.create()`.
- [**SD-01**](SD-01/): **in a collaboration room, accept/reject fails with `INVALID_CONTEXT` for any tracked change after a footnote reference** in the same paragraph. The reported change range is shifted one character per preceding footnote reference; the same calls work without a room.
- [**SD-03**](SD-03/): SuperDoc writes **two `<w:del/>` into one paragraph mark** (deleting across an already-deleted paragraph mark), then refuses its own file: Accept All fails with `INVALID_INPUT` for the whole document. [Video](SD-03/video/SD-03.mp4).
- [**SD-09**](SD-09/): **tracked delete across table cells is rejected in the editor.** Selecting across cells and pressing Backspace gives "This edit couldn't be completed". The engine-level `doc.delete` now works on 2.23.0; the editor path still rejects it. [Video](SD-09/video/SD-09.mp4).
- [**SD-11**](SD-11/): **can't delete a paragraph containing a REF cross-reference field.** `blocks.delete` (tracked and direct) → `paragraph-tracked-wrapper-unsupported`; `deleteRange` → `unsupported-context`. [Video](SD-11/video/SD-11.mp4).
- [**SD-32**](SD-32/): **the "final" (clean) export isn't clean.** `export.toDocx({mode:"final"})` leaves `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:trPrChange`, `w:tblPrChange`, `w:tcPrChange`, `w:pPrChange`, `w:rPrChange` in the file, and `report.warnings` doesn't mention them. The browser's `export({isFinalDoc:true})` is byte-identical to the tracked export.
- [**SD-55**](SD-55/): **comment replies fail.** `ui.comments.reply()` returns `INVALID_CONTEXT unsupported-context` even in a plain local session, and the reply composer silently does nothing, so replies never reach the exported `comments.xml`. [Video](SD-55/video/SD-55.mp4).
- [**SD-79**](SD-79/): **grouped text boxes and fill-less shapes render as solid black boxes** (hatched placeholders on older releases), hiding content in PDF-converted documents. 15 of 16 unfilled `custGeom` shapes go black in our sample; `<a:noFill/>` fixes the fill case.

## Medium

**Deleted (struck-through) tracked text.** These five share a root cause: anything that targets deleted text needs tracked coordinates, and much of the API doesn't support them.
- [**SD-06**](SD-06/): Accept/Reject on a selection that spans a fully deleted paragraph is a silent no-op. This applies to SuperDoc's own context-menu **Accept change** / **Reject change** (verified by hand) and to `decide({kind:"range"})` → `TARGET_NOT_FOUND`. Related upstream: superdoc/docx-editor#4047. [Video](SD-06/video/SD-06.mp4).
- [**SD-07**](SD-07/): `selection.current().activeChangeIds` reports raw revision ids that don't match `trackChanges.list()`, and is empty for a deleted paragraph mark, so selection-based accept leaves changes behind.
- [**SD-08**](SD-08/): bold / highlight / clear formatting on a selection reaching deleted text is refused (`text-range-cross-paragraph-tracked-coordinate-unsupported`). [Video](SD-08/video/SD-08.mp4).
- [**SD-25**](SD-25/): locators can't see deleted text (`includeDeletedText:true` has no effect), so a hidden edit makes visible text ambiguous and plans fail with "selector matched 2 ranges".
- [**SD-40**](SD-40/): bookmarks can't span from deleted text into kept text in a table cell, and silently shrink to exclude text that Reject restores.

**Other**
- [**SD-17**](SD-17/): a refused decision is invisible to the integrator: Accept All refuses with `INVALID_INPUT` but raises no event, exception or console error, and the reactive list goes blank while the sidebar still shows the changes.
- [**SD-18**](SD-18/): `setTrackedChangesPreferences({mode:"final"})` changes config but the document still renders tracked markup ("original" works).
- [**SD-20**](SD-20/): `@superdoc/sdk` agent actions silently make an **untracked** edit when `changeMode` is omitted (`changeMode ?? 'direct'`), even with a tracked default.
- [**SD-33**](SD-33/): no clean ("final") export from a live collaboration room: `export.toDocx` is refused (`CAPABILITY_UNSUPPORTED`); `document.save()` only offers review-preserving output in a room.
- [**SD-47**](SD-47/): clicking a tracked change inside commented text opens the comment card, never the change card (vendor ticket IT-1479). [Video](SD-47/video/SD-47.mp4).
- [**SD-49**](SD-49/): there's no public way to open or focus a review card. `setActive()` reports success but no card opens; `navigateNext()` to an off-screen change resolves without doing anything; and **`ui.trackChanges.list()` only returns changes on the painted pages**.
- [**SD-52**](SD-52/): the comment rail empties (`getSnapshot().total` 1 → 0) when you scroll away from the only comment in a long document. [Video](SD-52/video/SD-52.mp4).

## Low

- [**SD-108**](SD-108/): a full-page header image (page art: logo and footer band, `behindDoc`, `wrapNone`, extent = the whole page) is shrunk to the body height between the margins and centred, so the logo lands on the title and the footer floats mid-page. Word draws it at full size. [Side-by-side](SD-108/screenshots/side-by-side.png).
- [**SD-60**](SD-60/): `roomMode:"create"` on an existing room fails to open the document (`collaboration-v2-room-already-exists`). It now shows an error card, but there's no create-or-join option.

## Worth mentioning

- [**SD-15**](SD-15/): deciding one of two linked changes (a paragraph-mark merge pair) silently resolves the other, and the receipt doesn't say so, so loops over a captured id list fail with `TARGET_NOT_FOUND`.
- [**SD-16**](SD-16/): a refused whole-document `decide({kind:"all"})` resolves `{success:false, INVALID_INPUT}` instead of throwing, while single-change refusals throw, so `try/catch` callers treat a failed Accept All as success.
- [**SD-29**](SD-29/): `doc.diff.compare()` ignores `sourceSnapshot` and always diffs the live document against `targetSnapshot`.
- [**SD-38**](SD-38/): a missing bookmark rejects with `TARGET_NOT_FOUND` wrapped in `WorkerTransportError` in the browser (the SDK returns the plain code).
- [**SD-64**](SD-64/): `@superdoc-dev/superdoc-yjs-collaboration` 1.0.2: the README example crashes, `generateParams` assumes Express params, the `welcome()` rejection goes unhandled, and the package bundles its own yjs (`instanceof` fails, and inserting host-yjs content crashes).

## Missing capabilities

- [**SD-106**](SD-106/): create a tracked change with a given author, date and id, or reinstate a decided one. Needed to undo an accept/reject without re-attributing the counterparty's change.
- [**SD-107**](SD-107/): `getRect` / positions by id for tracked changes and bookmarks, and a way to list the changes inside a range or bookmark.
- [**SD-62**](SD-62/): collaboration room tooling: delete/evict a room, an initial-sync barrier before a headless client acts, and a per-edit durability acknowledgement.
- [**SD-83**](SD-83/): document-wide geometry and decoration: no rect for unpainted content, and entity-address `getRect` is declared in the types but returns `invalid-target` at runtime.
- [**SD-103**](SD-103/): ribbon/command gaps: grow/shrink font, a one-step format painter, image insert from a file or blob, and `table-fix` (permanently unsupported).

## Needs repro

Seen in production, but we couldn't trigger them on 2.23.0 by script or by hand. Each folder lists the exact error strings and what we tried.

- [**SD-34**](SD-34/): `save-failed`: "table structural projection span drift…" after table edits; every save fails until remount.
- [**SD-35**](SD-35/): `collaboration save barrier failed: projection-session-sync-failed` after a rejected edit.
- [**SD-71**](SD-71/): SDK host crashes in long agent sessions (`Host process disconnected` at ~2 GB, `Host watchdog timed out waiting for cli.invoke`).
- [**SD-50**](SD-50/): `comments.create` → `INTERNAL_ERROR patch-precondition-failed` on some anchors.
- [**SD-51**](SD-51/): new markers invisible while a collaborator streams edits.
- [**SD-70**](SD-70/): `comments.list()` right after `onReady` in a room → `PRECONDITION_FAILED`.
- [**SD-39**](SD-39/): bookmark end refused at a paragraph's exact text length.

## Fixed in 2.23.0 (verified, for reference)

- [**SD-05**](SD-05/): `ui.trackChanges.acceptAll()` / `rejectAll()` now decide every change.
- [**SD-10**](SD-10/): deleting a fully selected paragraph (headless and margin-drag + Backspace) now works.
- [**SD-26**](SD-26/): scoped `replace_text` now makes a word-level tracked replace.
- [**SD-82**](SD-82/): fit-width zoom now tracks the pane width.
- Partly fixed: the engine-level cross-cell delete (SD-09), the `original` / `off` markup modes (SD-18), the collaborative `document.save()` (SD-33), the error card for a wrong room mode (SD-60), the connection-status event (SD-62), and the reactive caret-in-table state (SD-103).

## Layout

| Path | What |
|---|---|
| `harness/` | bare SuperDoc page (Vite), Playwright helpers, a bare Hocuspocus room server, headless SDK helpers |
| `SD-xx/` | one issue: `README.md`, `repro.mjs`, fixtures, `results-2.23.0.json`, `screenshots/` |
| `_fixtures/` | shared anonymised real-world-shaped documents used by several repros |
| `_example/` | smoke test for the harness |
