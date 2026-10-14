# SD-40 — Bookmarks can't span a tracked deletion in a table cell, and silently shrink on reject

Part of the deleted-text group: SD-06, SD-07, SD-08, SD-25, SD-40.

## Summary

A bookmark cannot be placed so that it spans both a tracked deletion and
adjacent kept text inside a table cell: the bookmark's end marker refuses
any tracked-coordinate offset that crosses from the deletion into kept text.
Worse, a bookmark that was placed over the *visible* value of a clause
before a tracked edit is rejected silently shrinks afterward, excluding the
text that reject just restored — with no error, no event, and no way to
tell the bookmark moved. For contract fields that are tracked by bookmark
(merge fields, clause anchors, data-extraction ranges), this means rejecting
a tracked change in a table cell can leave the field's bookmark pointing at
the wrong (partial) text with no indication anything happened.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: REPRODUCES** (both the coordinate-space refusal and the reject-shrink consequence).
- Headless `@superdoc/sdk` `createSuperDocClient({runtime:"v2"})` — pure Document API, no browser needed.

## Steps to reproduce

Fixture `table-cell-replacement.docx` (from the shared `_fixtures/` corpus,
`tc-probe-06-replacement-table-cell-placeholder.docx`): a 3-row table whose
"Supplier" value cell (paragraph `00000003`) carries one tracked
replacement — deleted text `{{Supplier Legal Description}}` (30 chars) →
inserted text `TEST ` (5 chars) — immediately followed by untouched kept
text `TEST - MIRA Consulting Company` (30 chars). Visible cell text (35
chars): `TEST TEST - MIRA Consulting Company`.

UI steps (what a user/integrator does):
1. Open a document with a table whose cell value was filled in via a tracked edit over a merge-field placeholder (a common contract-template pattern).
2. Place a bookmark (or merge-field anchor) around the cell's whole fillable value, intending it to track the clause regardless of whether the fill is later accepted or rejected.
3. Reject the tracked fill.
4. Observe: the field/bookmark's bounds silently no longer match the clause — they exclude the text reject just put back.

Script: `node SD-40/repro.mjs`. Uses `doc.bookmarks.insert`/`.get` and `doc.trackChanges.decide({decision:"reject"})` directly against the Document API.

## Expected / Actual

**Expected:** A bookmark can be placed around the full logical clause (deleted lead-in + kept value) using tracked coordinates, and a bookmark placed before a reject keeps covering the same logical clause content afterward (growing to include restored text, not excluding it).

**Actual:**

**(a) Coordinate-space refusal in the table cell:**
- `bookmarks.insert` with `coordinateSpace:"tracked"`, range `0..30` (exactly the deleted placeholder): **succeeds**.
- `bookmarks.insert` with default (visible) coordinates, range `0..35` (exactly the kept value): **succeeds**.
- `bookmarks.insert` with `coordinateSpace:"tracked"`, range `0..65` (the whole logical clause, deleted + kept): **refused** — `code: "COMMAND_FAILED"`, `message: "Unable to place the bookmark end marker at offset 65 (invalid-range)."`
- `bookmarks.insert` with `coordinateSpace:"tracked"`, range `25..40` (crossing the deleted/kept boundary at offset 30): **refused** the same way, `"Unable to place the bookmark end marker at offset 40 (invalid-range)."`
- So a bookmark can live entirely inside the deletion, or entirely inside the kept text, but never span across that boundary in tracked coordinates — there is no single bookmark that can wrap the whole clause.

**(b) Silent shrink on reject:**
- A bookmark `ClauseValue` placed over the full visible value (`0..35`, default coordinates) correctly covers `"TEST TEST - MIRA Consulting Company"`.
- `trackChanges.decide({decision:"reject", target:{kind:"id", id}})` on the one tracked replacement **succeeds** (`success:true`), restoring `{{Supplier Legal Description}}` and removing the inserted `TEST `. SuperDoc's own receipt even reports the exact `textRangeShifts` this causes (`delta: -5` then `delta: 30` at the relevant char offsets).
- Re-reading the bookmark afterward: `range` moved from `{from:0, to:35}` to `{from:30, to:60}` — its length shrank from 35 to 30, and `bookmarks.get` now resolves to `"TEST - MIRA Consulting Company"` — the restored placeholder `{{Supplier Legal Description}}` is **excluded** even though it now occupies exactly the span (offsets 0-30) the bookmark used to start at.
- 0 errors or exceptions anywhere in this sequence — the shrink is entirely silent.

Full raw output: `results-2.23.0.json`.

## Root cause / analysis

The bookmark end-marker placement logic appears unable to resolve a tracked-
coordinate offset that requires crossing from inside a tracked deletion's
text into the adjacent kept text within the same paragraph/cell (part a) —
consistent with SD-08's and SD-06's pattern of operations refusing to
"cross" a tracked-deletion boundary rather than treating tracked-space
offsets as a single continuous address space. Separately, a bookmark's
start/end anchors appear to be maintained purely as visible-text character
offsets, re-derived after each mutation via the kind of `textRangeShifts`
delta math visible in the reject receipt above — rather than being anchored
to a stable logical position (e.g. "the start of this paragraph's content,
regardless of what's currently deleted there"). When a reject grows the
visible text by re-inserting previously-deleted content *before* the
bookmark's anchor point, the delta math shifts the bookmark's start forward
by exactly the restored length, rather than recognizing that the bookmark
should now also cover the newly-visible text preceding it.

## Suggested fix

Allow bookmark end-marker placement to resolve tracked-coordinate offsets
that cross a tracked-deletion boundary, the same way other Document API
ranges are expected to (once SD-08/SD-06's cross-paragraph tracked handling
is fixed, this is likely the same underlying range-resolution gap).
Separately, when a tracked-change decision changes the visible-text length
before a bookmark's anchor, consider whether the bookmark's documented
intent (wrapping "this clause's value") should cause it to grow to cover
newly-restored/newly-inserted content, rather than silently preserving only
its old character-offset window. Possible workaround for integrators until
fixed: re-resolve and re-set any bookmark whose range overlaps a tracked
change's `navigationTarget.blockId` immediately after every accept/reject in
that block, rather than assuming bookmark ranges remain valid for the same
logical content across a decision.

## Related

SD-06, SD-07, SD-08, SD-25.

## Notes / caveats

- `ui.viewport.getRect` (reported elsewhere as unable to resolve deleted-
  text offsets) was not retested here — it is part of the `createSuperDocUI`
  public facade, which requires explicitly constructing a UI controller
  around the editor (see SD-06's notes on `createSuperDocUI` /
  `BUILT_IN_TOOLBAR_CATALOG`); time-boxed out. The bookmark-level findings
  above are from the plain Document API and don't depend on that facade.
