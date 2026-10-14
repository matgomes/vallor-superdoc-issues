# SD-82 — Fit-to-width zoom: FIXED on 2.23.0

## Summary

A previously reported defect (against superdoc 2.9.0) claimed `setZoomMode('fit-width')`
measured the wrong, already-zoomed DOM element for the page's base width and re-derived that
base width on every pass, causing the computed zoom to inflate or spiral instead of converging.
On superdoc 2.23.0 this does not reproduce: the viewport-fit implementation has been
substantially rewritten, measures the document's true (zoom-independent) page width, and
produces a stable, correctly-proportioned zoom value on every resize with no drift.

## Environment

- superdoc **2.23.0**: **FIXED** — converges immediately, no drift across repeated
  re-evaluations at a fixed width.
- superdoc 2.9.0 (original report): claimed broken — not independently re-verified here (no
  2.9.0 side-install was done; see brief guidance to only do a version comparison install when
  specifically needed). Reported here purely as the baseline the original bug was filed against.
- Chromium via Playwright (headless), Node 24, bare `new SuperDoc(...)` mount via
  `harness/index.html`.

## Steps to reproduce

UI steps: open any `.docx` in the harness, call `superdoc.setZoomMode('fit-width')` (or trigger
it via the "Fit Width" zoom control), then resize the browser/viewport pane repeatedly to a
mix of widths, including some narrower than the page itself (e.g. 300-600px against an 816px-wide
US Letter page) and some back to a previous width, watching `superdoc.getZoomState()` /
`superdoc.getViewportMetrics()` after each resize.

Script: `node SD-82/repro.mjs` (from the repo root). It:
1. Opens `_fixtures/numbering-nostart-fixture.docx` in `editing` mode.
2. Calls `window.__sd.setZoomMode("fit-width")`.
3. Re-triggers the container-width watcher 5× at the *same* final width (1280, via a 1px
   nudge-and-back) and checks the reported zoom value is identical every time (no spiral).
4. Walks the viewport through 9 widths, including several below the page's own ~816px width, and
   checks the applied zoom tracks the pane width proportionally.
5. Confirms `getViewportMetrics().documentWidth` — the un-zoomed base page width — is
   **identical** across every one of those width changes; if the old bug were still present,
   this value would drift with the current zoom level instead of staying constant.
6. Resizes the pane to 500px (narrower than the 816px page), calls
   `window.__sd.setZoomMode("fit-width")`, screenshots, calls it again with **no resize in
   between**, screenshots again, and compares the resulting zoom against
   `paneWidth / pageWidth` — the most literal form of the original claim (call it twice at an
   unchanged, sub-page width; a re-derived-from-the-zoomed-page bug would show the second call
   drifting away from the first and from the geometric ratio).

## Expected / Actual

Expected (what "fixed" looks like): the applied zoom equals `availableWidth / documentWidth`
(clamped to `[min, max]`), `documentWidth` is a single measured constant independent of the
current zoom, and repeated evaluations at an unchanged width report an unchanged zoom.

Actual on 2.23.0 — exactly that:

| container width | `documentWidth` | unclamped `fitZoom` | applied zoom (`value`) |
|---|---|---|---|
| 1280 | 816 | 157 | 100 (clamped, `max:100`) |
| 1000 | 816 | 123 | 100 (clamped) |
| 1500 | 816 | 184 | 100 (clamped) |
| 900  | 816 | 110 | 100 (clamped) |
| 600  | 816 | 74  | 74 |
| 400  | 816 | 49  | 49 |
| 816  | 816 | 100 | 100 |
| 300  | 816 | 37  | 37 |

`documentWidth` is the constant 816px (a US-Letter page at 96 DPI) at **every** container width
— it is never re-derived from the currently-zoomed page, which is exactly the behavior the
original bug report says was missing. Five repeated re-evaluations at a fixed 1280px width all
reported `value: 100` with no drift. No console/`onException` errors were raised during any of
this.

**Direct double-call check at a narrow (500px) pane** (the literal repro steps: narrower-than-page
pane, call `fit-width` twice, compare to the geometric ratio):

| | zoom (`value`) |
|---|---|
| after 1st `setZoomMode("fit-width")` call | 61% |
| after 2nd call, no resize in between | 61% |
| `paneWidth / pageWidth` = 500 / 816 | 61% (61.27%, rounded) |

The two calls are identical (`61% == 61%`, `identicalAcrossCalls: true`) and both match the
geometric ratio (`matchesPaneWidthOverPageWidthRatio: true`) — no spiral, no drift, correct
proportion. The two post-call screenshots (`fit-width-narrow-pane-call-1.png` /
`fit-width-narrow-pane-call-2.png`) are byte-identical (same file size), confirming there is no
visible difference between the first and second call either.

## Evidence

Full data: `SD-82/results-2.23.0.json` (see `narrowPaneDoubleCall` for the direct check above).
Screenshots: `SD-82/screenshots/fit-width-1280.png` (steady state at 1280px, 100% zoom),
`fit-width-narrow-pane-call-1.png` / `fit-width-narrow-pane-call-2.png` (500px pane, before/after
the second `fit-width` call).

## Root cause / analysis

Reading `superdoc` 2.23.0's bundled source (`node_modules/superdoc/dist/superdoc.es.js`), the
fit-width machinery (`useViewportFit`, documented inline as "Viewport fit tracking") now:
- Resolves the document's base page width from actual page/editor geometry
  (`resolveEditorPageWidth`, falling back to `editor.getPageStyles()`), not from a DOM element
  that's subject to the current CSS zoom transform.
- Where a DOM measurement fallback is unavoidable (no page geometry available), it explicitly
  normalizes by dividing the measured width by the current zoom factor
  (`measured / zoomFactor`), which is precisely the missing step the original bug report
  describes.
- States as an explicit invariant in its own code comment that the base width is "re-resolved on
  every evaluation (never latched)" and is a "policy-free measurement" — i.e. measurement and
  zoom-clamping policy are now deliberately separated, which structurally prevents the
  feedback-loop (measurement reads back its own previous output) that caused the original spiral.

This reads as a genuine rewrite of the subsystem between 2.9.0 and 2.23.0, not an incidental
side effect.

## Suggested fix

None needed — this is a FIXED report, not an open bug.

## Related

None.
