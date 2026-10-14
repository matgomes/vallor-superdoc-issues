# SD-06 — Accept/Reject on a selection spanning a fully-deleted paragraph is a silent no-op

Part of the deleted-text group: SD-06, SD-07, SD-08, SD-25, SD-40.

Upstream: **superdoc/docx-editor#4047**.

## Summary

When a user selects a range that spans several paragraphs — one of which is
*entirely* a single tracked deletion — and accepts or rejects that selection,
nothing happens: no error, no document change, no visible feedback. This
happens even though the tracked change physically sits inside the requested
selection. For contract redlining this means a reviewer's Accept/Reject click
on a struck-through clause can silently fail, leaving the deletion
unresolved with no indication anything went wrong.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: REPRODUCES.**
- Previously tested on superdoc 2.20.0/@superdoc/sdk 2.17.0 and 2.21.0/2.18.0: REPRODUCES identically (prior internal notes).
- Bare `new SuperDoc({ selector, document, user })` mount, no toolbar chrome, Chromium via Playwright 1.64.0, Node (headless SDK via `@superdoc/sdk` `createSuperDocClient({runtime:"v2"})`).

## Video

[`video/SD-06.mp4`](video/SD-06.mp4) (SuperDoc 2.23.0, Chrome, local harness). The built-in context-menu Accept change and Reject change on a deleted run do nothing. The tracked-change count stays at 1 and no error is reported. Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

Fixture `whole-paragraph-deleted.docx`: three paragraphs —
1. "Intro paragraph that stays." (kept)
2. "This whole paragraph was deleted." (tracked delete, author Jane Doe — one logical tracked change)
3. "Closing paragraph that stays." (kept)

UI steps (what a reviewer does):
1. Open the document in SuperDoc's editor.
2. Click at the start of paragraph 1, then shift-click (or drag) to a point inside paragraph 3 — a selection that passes through the fully-deleted paragraph 2.
3. Accept (or reject) the selection.
4. Observe: nothing happens. The deletion is still listed as an open tracked change; the document is unchanged.

Script: `node SD-06/repro.mjs`. It drives the exact same shape two ways:

- **Headless** (`@superdoc/sdk`): builds a `TextTarget` with segments in paragraph 1 and paragraph 3 (omitting paragraph 2, since its visible length is 0) and calls `doc.trackChanges.decide({decision:"accept", target:{kind:"range", range}})`.
- **Browser**, using only SuperDoc's own public surfaces (no Vallor code): `editor.authoring.setSelectionTarget({target})` sets a real cross-paragraph `SelectionTarget` on the live engine selection (the same selection state a toolbar button would read). `editor.doc.selection.current()` reads back the resulting snapshot — including its own computed `target` (a 3-segment `TextTarget`, one zero-width segment over the deleted paragraph) and `activeChangeIds`. That exact snapshot's `target` is then fed into `trackChanges.decide({kind:"range", range: snapshot.target})`.

## Expected / Actual

**Expected:** Accept/Reject resolves the tracked change whose text falls inside the selection, regardless of whether an intervening paragraph happens to be wholly deleted.

**Actual:**
- Headless: `doc.trackChanges.decide({kind:"range", ...})` **throws** `code: "TARGET_NOT_FOUND"`, message `trackChanges.decide range: selected range did not overlap any active tracked change.` No document change.
- Browser, using the engine's own live selection snapshot: `doc.trackChanges.decide({kind:"range", range: snapshot.target})` **resolves** (does not throw) with `{success:false, failure:{code:"TARGET_NOT_FOUND", message:"trackChanges.decide range: selected range did not overlap any active tracked change."}}`. Tracked-change count unchanged (1 before and after).
- The same selection snapshot's `activeChangeIds` (`decide({kind:"ids", ids: snapshot.activeChangeIds})`) **succeeds**: `{success:true, ...}`, the tracked change is removed, and the document text correctly reflects acceptance.
- Sanity check (`decide({kind:"id", id})` on a single, non-crossing accept) also succeeds.
- `snapshot.activeChangeIds` returns **2** raw ids for this **1** logical tracked change (the paragraph-mark deletion and the run deletion resolve to separate ids) — see SD-07, which documents this split in more detail.
- 0 `onException`/console errors in either pass.

Full raw output: `results-2.23.0.json`. Screenshot of the post-attempt state (document unchanged, deletion still open): `screenshots/after-decide-attempts.png`.

## Root cause / analysis

The middle paragraph is **entirely** the tracked deletion, so SuperDoc reports
its current (post-delete) visible length as 0. Any text-range segment over
that paragraph is necessarily zero-width. The range resolver backing
`trackChanges.decide({kind:"range"})` appears to determine "does this range
overlap a tracked change" purely from the segments' live-text extents, never
consulting the deleted content still occupying that paragraph — so a
zero-width segment over a wholly-deleted paragraph can never "contain" the
very change that deleted it. This reproduces even when the `range` passed is
the exact `TextTarget` the engine itself just computed for the live
selection (not a hand-built approximation), which rules out a "selection
projection" bug specific to one call site — the gap is in `decide`'s range
resolver itself. This would affect any selection that merely *passes through*
(rather than starts inside) a fully-deleted paragraph or table cell, matching
the upstream framing of selections spanning multiple paragraphs/cells.

Separately, `decide({kind:"range"})` is inconsistent about throwing vs.
resolving with `success:false` for the identical failure across the two
runtime adapters exercised here (headless SDK throws; the browser-mounted
engine resolves) — worth noting as its own small inconsistency alongside the
core bug.

## Suggested fix

The range resolver for `trackChanges.decide` should consult tracked-deleted
content (not just live/visible text extents) when determining whether a
`TextTarget` segment overlaps an active tracked change — particularly for
zero-width segments over paragraphs that are themselves wholly deleted.
Given a selection whose `activeChangeIds` (from `selection.current()`)
already correctly identifies the overlapping change(s), the `decide({kind:
"range"})` path could also fall back to resolving by those same ids rather
than failing closed. Possible workaround for integrators until fixed: resolve
the live selection to `activeChangeIds` first and decide by `{kind:"ids",
ids}` instead of `{kind:"range"}` when the selection is non-empty.

## Related

SD-07 (same selection snapshot's `activeChangeIds` reports 2 raw ids for 1
logical change), SD-08, SD-25, SD-40.

## Manual verification (built-in UI command)

Verified by hand on 2.23.0 in Chrome. Select across the three paragraphs, right-click, then choose SuperDoc's own
**Accept change** or **Reject change**: both are silent no-ops (the change stays, `trackChanges.list().total` stays 1, and nothing
reaches `onException`). Steps and screenshots: [`MANUAL-STEPS.md`](MANUAL-STEPS.md).

## Notes / caveats

- No toolbar chrome is mounted by a bare `new SuperDoc({selector, document,
  user})` call (no DOM `[contenteditable]`, `activeEditor.view`/`.state` are
  `null`) — the legacy private Vue toolbar's `track-changes-accept-selection`
  dispatcher could not be clicked directly through real mouse/keyboard input
  in this harness. Instead, the exact selection + decide machinery that
  dispatcher is documented to use (`BUILT_IN_TOOLBAR_CATALOG` → `disposition:
  controller-routed` → the live selection → `decide()`) was exercised
  end-to-end through SuperDoc's own public `editor.authoring` and
  `editor.doc.selection`/`editor.doc.trackChanges` surfaces, which is what
  produced the browser-pass result above.
- The table-cell variant of this selection (spanning cells rather than
  paragraphs) was not retested — time-boxed out. A fixture with exactly one
  tracked deletion whose selection crosses cells (not the two-deletion
  `tc-probe-12-deleted-table-row-text.docx` fixture, which hits the working
  ids-path because it has >1 active change) would be needed.
