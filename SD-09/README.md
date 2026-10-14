# SD-09 — Tracked delete across table cells: fixed at the engine level, still rejected by the editor

## Summary

Deleting (with track changes on) a selection that spans from one table cell into an
adjacent cell — same row or across rows in the same column — used to be rejected outright
by SuperDoc's document API with `COMMAND_FAILED text-range-cross-table-cell`. On 2.23.0 that
engine-level rejection is **gone**: the same request now produces a correct, single tracked
deletion spanning both cells. However, driving the identical edit through the real editor
(select across two cells with the mouse, press Backspace in Suggesting mode) is **still
rejected** today, with a different, editor-level error (`edit-rejected`). For end users this
means: a contract reviewer who selects across a table boundary and hits Backspace still sees
"This edit couldn't be completed. Adjust the selection and try again." and nothing happens —
the underlying engine fix never reaches them because the editor's own selection-to-delete
dispatch has not been updated to use it.

## Environment

| superdoc | `doc.delete()` text-range API (headless) | editor UI (mouse-select + Backspace, suggesting mode) |
|---|---|---|
| 2.23.0 (`@superdoc/sdk` 2.20.0) | **FIXED** — succeeds, single tracked change | **REPRODUCES** — `edit-rejected` |
| 2.20.0 / 2.21.0 (prior investigation, `@superdoc/sdk` 2.17.0/2.18.0) | `COMMAND_FAILED text-range-cross-table-cell` | not tested at the time |

Node 24, headless `@superdoc/sdk` for the API check; Playwright Chromium (headless) against
the bare harness page for the UI check. No integrator/Vallor code involved.

## Video

[`video/SD-09.mp4`](video/SD-09.mp4) (SuperDoc 2.23.0, Chrome, local harness). A tracked deletion across two table cells is rejected (count stays 0). The same deletion inside one cell is tracked (count 1). Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

Run: `node SD-09/repro.mjs` (builds no fixtures itself — run `node SD-09/make-fixture.mjs`
first if `schedule-of-fees.docx` is missing; it is committed in this folder already).

Fixture: `schedule-of-fees.docx` — synthetic "Schedule 1 - Fees" table (3 columns x 3 rows
incl. header), built entirely through the SDK (`make-fixture.mjs`, uses
`doc.create.table` + `doc.tables.setCellText`, no hand-authored OOXML). Row 1 =
`Hosting` | `900 per month` | `Net 45`; row 2 = `Support` | `300 per month` | `Net 30`.

### (a) Headless SDK — `doc.delete()` text-range API

For each of three scenarios, open a fresh copy of the fixture and call:
```js
doc.delete(
  { target: { kind: "selection", start: { kind: "text", blockId, offset }, end: { kind: "text", blockId, offset } }, behavior: "exact" },
  { changeMode: "tracked" },
);
```
1. Same row, partial range: `Hosting[1:]` → `900 per month[:-1]`.
2. Same row, full cell-to-cell range: `Hosting[0:]` → `900 per month[:]`.
3. Cross-row, same column: `Hosting[0:]` → `Support[:]` (spans the intervening `Net 45` cell
   too).

### (b) Browser UI — mouse-drag selection + Backspace

1. Open the fixture in the bare harness page, `mode=suggesting`.
2. Mouse-down just inside "Hosting", drag to just past "900 per month", mouse-up (a native
   cross-cell drag selection, highlighted in the screenshot below).
3. Press Backspace.

## Expected / Actual

**Expected:** the engine-level fix and the editor's own edit path agree — either both allow
a cross-cell tracked delete, or both refuse it with the same, documented error.

**Actual:**

(a) Headless, all three scenarios **succeed**:

| scenario | result |
|---|---|
| same-row, partial range | `success:true`, one tracked change, deleted text `"osting\n900 per month"` |
| same-row, full cell-to-cell range | `success:true`, one tracked change, deleted text `"Hosting\n900 per month"` |
| cross-row, same column | `success:true`, one tracked change, deleted text `"Hosting\n900 per month\nNet 45\nSupport"` |

Each produces exactly one `txId` and one tracked change spanning the full requested range —
not two separate per-cell changes, not a silent partial/truncated delete. This is a genuine,
correct fix relative to the 2.20.0/2.21.0 behavior.

(b) Browser, the identical user action is **rejected**:
```json
{ "type": "onException", "code": "edit-rejected", "message": "This edit couldn't be completed. Adjust the selection and try again." }
```
`trackChanges.list().total` stays at 0 before and after — no partial change is written.
Screenshot `screenshots/03-after-backspace.png` shows the selection still highlighted and
both cells' text untouched after Backspace.

## Evidence

- `results-2.23.0.json` — full script output for both passes.
- `screenshots/01-before-selection.png`, `02-after-cross-cell-selection.png` (mouse-drag
  selection visibly spanning "Hosting" and "900 per month"), `03-after-backspace.png`
  (selection unchanged, cell text unchanged, confirming the edit did nothing).

## Root cause / analysis

The document-model-level guard that used to reject any text range whose start and end
blocks sit in different table cells (`text-range-cross-table-cell`) appears to have been
removed or relaxed between `@superdoc/sdk` 2.18.0 and 2.20.0 — `doc.delete()` now resolves
the cross-cell range correctly and writes one coherent tracked deletion. The editor's own
Backspace/Delete-key dispatcher, however, still appears to carry its own, earlier
selection-shape check ahead of calling into the document API — it never reaches the now-working
`doc.delete()` path, and fails fast with the generic `edit-rejected` instead. This is the
same "engine fixed, editor dispatcher not updated to match" shape previously seen in
SD-06 (`track-changes-accept-selection`) — the underlying document API moves faster than
the editor code paths that are supposed to call it.

## Suggested fix

- Update the editor's keyboard Backspace/Delete handling (and any other UI entry point that
  currently special-cases a same-cell-only selection) to use the same, now-working
  `doc.delete()` cross-cell text-range path that the SDK already exercises correctly,
  instead of refusing the selection shape before ever calling it.
- Add a regression test at the editor level (not just the document-API level) for a
  cross-cell Backspace, since this class of fix has now regressed/lagged behind the engine
  twice (here and in SD-06).

**Possible workaround** (integrator-side): keep a UI-level interceptor that, on
`edit-rejected` for a cross-cell selection, retries the delete via the document API's
`doc.delete()` text-range call directly (now confirmed to work) instead of leaving the user
stuck.

## What the user sees (manual, 2.23.0, Chrome)

In suggesting mode, drag-select from "900 per month" into "Net 45" (two cells) and press Backspace: nothing is deleted and
nothing is shown. The rejection, `edit-rejected` "This edit couldn't be completed. Adjust the selection and try again.",
only reaches `onException`, so the user just sees their keystroke ignored.

## Related

- SD-06 — the same "engine operation works headless, the editor's own selection dispatcher
  still fails" pattern, for Accept/Reject on a selection spanning blocks.
