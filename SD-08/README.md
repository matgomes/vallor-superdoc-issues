# SD-08 — Inline formatting is refused on any selection that reaches tracked-deleted text

Part of the deleted-text group: SD-06, SD-07, SD-08, SD-25, SD-40.

## Summary

Applying inline formatting (bold, highlight, or clearing formatting) to a
selection that reaches struck-through (tracked-deleted) text is refused —
and there is no coordinate space in which the operation can be expressed: a
tracked-coordinate selection crossing a paragraph boundary is refused
outright, and the "resolve in visible coordinates" advice given for a
single-paragraph tracked selection is impossible to follow when the visible
text there has zero length. In a contract review, this means a reviewer
cannot bold, highlight, or clean up formatting on a redlined clause that
still contains struck-through text spanning more than one paragraph.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: REPRODUCES.**
- Headless `@superdoc/sdk` `createSuperDocClient({runtime:"v2"})` — this is a pure Document API / engine defect, no browser or UI involvement needed to reproduce it.

## Video

[`video/SD-08.mp4`](video/SD-08.mp4) (SuperDoc 2.23.0, Chrome, local harness). Bold applied across the whole range in suggesting mode creates no tracked format change. Bold on the control paragraph creates a Format card (count 1 → 2). Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

Fixture `whole-paragraph-deleted.docx` (same as SD-06/SD-07): P1 "Intro
paragraph that stays." (kept, blockId `00000001`) / P2 "This whole paragraph
was deleted." (tracked delete, blockId `00000002`, visible length 0) / P3
"Closing paragraph that stays." (kept, blockId `00000003`).

UI steps (what a reviewer does):
1. Open the document.
2. Select from inside the first (kept) paragraph through the struck-through second paragraph.
3. Press Bold (Cmd/Ctrl+B), or apply a highlight color, or use "clear formatting."
4. Observe: nothing happens — no visible change, no error dialog.

Script: `node SD-08/repro.mjs`. Calls `doc.format.bold(...)` / `doc.format.apply(...)` directly against the Document API with a `SelectionTarget` whose `coordinateSpace` is `"tracked"`, both within a single paragraph and crossing into the deleted paragraph.

## Expected / Actual

**Expected:** Formatting applies to the selected run(s), including deleted text the user has explicitly reached with a cross-paragraph or tracked-coordinate selection (or at minimum, a clear, actionable error).

**Actual:**
- **Cross-paragraph, tracked coordinates** (`coordinateSpace:"tracked"`, selection from P1 into deleted P2) — `format.bold`, `format.apply({inline:{highlight}})`, and `format.apply` clearing several inline properties at once (`bold:null, italic:null, underline:null, highlight:null, color:null`) **all** throw the identical `code: "TRACK_CHANGE_COMMAND_UNAVAILABLE"`, `message: "text-range-cross-paragraph-tracked-coordinate-unsupported"`. The refusal happens before any specific inline property is considered — every inline-formatting operation is blocked the same way.
- **Single paragraph, tracked coordinates** (selection entirely inside the deleted paragraph) — `format.bold` throws `TRACK_CHANGE_COMMAND_UNAVAILABLE`, `message: "format selection uses tracked coordinates; resolve the target in visible coordinates instead."`
- **Same single-paragraph selection, default/visible coordinates** — throws a *different* error, `INVALID_ARGUMENT`, `"selection offsets exceed paragraph text."` — because the visible (post-deletion) text there has length 0, so no visible-coordinate offset can ever address it. The "resolve in visible coordinates" advice from the tracked-coordinate error is therefore unactionable for this case: there is no coordinate space, tracked or visible, in which this formatting request can succeed.
- **Sanity check** — a plain visible-coordinate bold entirely within the kept text of P1 succeeds normally (`changeMode:"direct"`, dirty:true, revision bumped), confirming `format.bold` itself works and the refusal is specific to selections that reach tracked-deleted text.
- 0 thrown-but-uncaught errors; every refusal above is a typed, synchronous throw from the Document API (no silent swallow at this layer) — but see "Related" for how this surfaces as a silent no-op once a UI only checks `success`/catches broadly.

Full raw output: `results-2.23.0.json`.

## Root cause / analysis

`format.apply`/`format.bold` (and by extension the other inline aliases) do
not support an inline-formatting target expressed in `coordinateSpace:
"tracked"` when it spans more than one paragraph — the selection-mutation
adapter fails closed with `text-range-cross-paragraph-tracked-coordinate-
unsupported` rather than translating the tracked-coordinate range into
per-paragraph operations. For a single paragraph that is *itself* wholly
deleted, the adapter instead suggests resolving in visible coordinates — but
a wholly-deleted paragraph has no visible text to resolve to, so this is a
dead end specific to the "entire paragraph deleted" shape (as in SD-06). The
net effect: any selection whose visible content is empty and whose
tracked-deleted content spans (or merely touches, across a boundary) more
than one paragraph has no reachable coordinate space for inline formatting.

## Suggested fix

Extend the selection-mutation adapter's inline-format path to decompose a
cross-paragraph tracked-coordinate target into per-paragraph tracked
sub-ranges (the same way cross-paragraph operations are already handled for
other mutation families), instead of refusing the whole target. For the
single-paragraph case, the error should not recommend an impossible visible-
coordinate resolution when the visible text is provably empty — either fall
back to tracked coordinates in that case, or state plainly that the
operation is unsupported on wholly-deleted content yet. Possible workaround
for integrators until fixed: skip inline-formatting commands when the live
selection's deleted-only span has no non-deleted segment to fall back to,
and surface that as a disabled toolbar state rather than attempting and
discarding the command.

## Related

SD-06 (same "fully-deleted middle paragraph" fixture shape), SD-07, SD-25,
SD-40.
