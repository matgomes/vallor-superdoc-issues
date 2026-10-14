# SD-79 — Grouped text boxes and stroke-only shapes render as solid black boxes, obscuring content

## Summary
Shapes produced by PDF→DOCX conversion tools (`wps:txbx` grouped inside `wpg:wgp`, and `custGeom` shapes with no explicit fill) render as solid black rectangles instead of their actual content. On an older SuperDoc release this appeared as a hatched "unsupported" placeholder; on 2.23.0 there is no hatching, but the same shapes paint solid black — equally unreadable, just a different visual failure mode. Any contract, purchase order, or other document converted from PDF (a common path for counterparty paper) that contains overlapping or vector-drawn shapes can have real content — labels, stamps, signature blocks — silently replaced by black rectangles.

## Environment
- **superdoc 2.23.0** (this repo's pinned version, `@superdoc/docx-engine` 0.22.0): **REPRODUCES** — see Evidence.
- **superdoc 2.20.0 / 2.21.0** (prior research, not re-run here): 2.20.0 showed the same shapes as hatched grey `superdoc-drawing-placeholder` boxes; 2.21.0 already showed the solid-black-box regression that persists on 2.23.0.
- Browser: Chromium (Playwright, headless), bare `new SuperDoc(...)` mount via this repo's `harness/`. No Vallor application code.

## Steps to reproduce

**UI steps:**
1. Open the harness on `SD-79/grouped-textboxes-po-overlay.docx` in `editing` mode.
2. Observe several solid black rectangles in place of what should be overlapping text-box labels and outlined shapes in the purchase-order layout (see `screenshots/grouped-textboxes-po-overlay.png`).
3. Open the harness on `SD-79/synthetic-alternatecontent-broken.docx`. "Shape A" (a text box grouped inside a `wpg:wgp`, wrapped in `mc:AlternateContent` with a VML `Fallback`) renders its label text correctly in this minimal, isolated form. "Shape B" (a stroke-only `custGeom`, no `<a:fill>` at all) renders as a solid black rectangle.
4. Open the harness on `SD-79/synthetic-alternatecontent-fixed.docx` — same two shapes, Shape A ungrouped and Shape B with an explicit `<a:noFill/>`. Both render correctly (outlined, transparent interior).

**Script:** `node SD-79/repro.mjs` (run from the repo root). For each fixture it mounts the document, counts `.superdoc-drawing-placeholder` elements (the old hatched-placeholder marker), counts solid-black-filled shape elements (SVG shapes with a black `fill`, and any CSS-background-black box ≥20×20px), checks whether the synthetic fixtures' own label text is visible, and screenshots the result. Writes `results-2.23.0.json`.

## Expected / Actual

**Expected:** a grouped text box renders its label (like an ungrouped one does), and a shape with no fill renders transparent/outlined-only (like Word does), not as an opaque black rectangle.

**Actual (2.23.0):**

| Fixture | Placeholders (`.superdoc-drawing-placeholder`) | Solid-black shapes | Notes |
|---|---|---|---|
| `grouped-textboxes-po-overlay.docx` (real structure: 10 groups, 16 `custGeom` shapes, 11 `mc:AlternateContent` blocks) | 0 | **15** | Essentially every unfilled `custGeom` shape in the document (16 total) renders black; no hatched placeholder anywhere. |
| `synthetic-alternatecontent-broken.docx` (1 grouped+`AlternateContent` text box + 1 unfilled `custGeom`) | 0 | **1** (the `custGeom` shape) | The grouped text box's own label renders correctly — isolating this one shape in a 2-shape document no longer reproduces a grouping-specific failure on 2.23.0. |
| `synthetic-alternatecontent-fixed.docx` (ungrouped text box + `custGeom` with `<a:noFill/>`) | 0 | **0** | Both shapes render cleanly, as expected. |

The **"missing fill defaults to solid black" defect reproduces cleanly, consistently, and is automatically countable**: in the real document 15 of 16 `custGeom` shapes without an explicit `<a:fill>` paint solid black (see `screenshots/grouped-textboxes-po-overlay.png`); in the minimal synthetic pair, the one unfilled shape reproduces every time and `<a:noFill/>` fixes it every time (`screenshots/synthetic-alternatecontent-broken.png` vs `screenshots/synthetic-alternatecontent-fixed.png`).

The **grouped-text-box-specific failure is harder to isolate on 2.23.0 than expected.** Our minimal synthetic (`wps:txbx` inside `wpg:wgp`, wrapped in a real `mc:AlternateContent` with a `wps` `Choice` and a VML `v:group`/`v:shape`/`v:textbox` `Fallback` — matching ConvertAPI/SolidFramework's actual output shape, unlike an earlier synthetic attempt that used a bare, unwrapped group) renders its label text correctly in isolation, whether the drawing is inline (`wp:inline`) or floating (`wp:anchor`) — we tried both. Yet the real 36-text-box, 10-group purchase-order fixture still has content missing/obscured throughout. We were not able to isolate, within this pass's time box, what additional structural element of the real document (multiple overlapping groups, z-order, a specific `mc:Ignorable` combination, or simply enough concurrent shapes) is needed to reproduce the grouped-text-box failure in a minimal file. **Treat the real-structure fixture as the authoritative repro for the grouping case; our minimal synthetic currently only reliably isolates the unfilled-shape case.**

No `onException` errors fired for any fixture — this is a silent rendering defect, not a crash.

## Evidence
- `screenshots/grouped-textboxes-po-overlay.png` — real-structure fixture, 15 solid black rectangles visible/counted, obscuring purchase-order line items and labels (the single light-grey square near the top is an intentionally blanked logo image, not part of this bug).
- `screenshots/synthetic-alternatecontent-broken.png` — minimal pair: grouped text box renders its label correctly; the unfilled `custGeom` renders solid black.
- `screenshots/synthetic-alternatecontent-fixed.png` — same pair, ungrouped + `<a:noFill/>`: both render correctly.
- `screenshots/synthetic-alternatecontent-anchored-broken.png` — same grouped text box as the first synthetic, floating via `wp:anchor` instead of `wp:inline`: label still renders correctly (visible in the screenshot, overlapping the black `custGeom` shape beneath it at the same position); only the `custGeom` shape is black.
- `results-2.23.0.json` — raw counts per fixture.
- Source confirmation: `groupChildUnsupported` / `render.drawing.group-child-unsupported`, `altContentNoSupportedChoice` / `render.drawing.altcontent-no-supported-choice`, and the `superdoc-drawing-placeholder` class name are all still present verbatim in the bundled `@superdoc/docx-engine` 0.22.0 (shipped with superdoc 2.23.0) — the diagnostic/fail-closed machinery itself has not been removed, only (for whichever condition is now triggering on the real fixture) its visual presentation changed from a hatched box to solid black.

## Root cause / analysis
*(Hypotheses from source-string inspection of the bundled `@superdoc/docx-engine`, not confirmed against original source — the vendor's own engineers can confirm against their source directly.)*

1. **Unfilled vector shape defaults to solid-black fill.** A `custGeom` (or similar) shape with no `<a:fill>`/`<a:noFill>` element appears to default its rendered fill to opaque black rather than to transparent/no-fill, which is the OOXML-spec-correct default for "no fill element present" in several contexts and matches Word's own rendering. This is a one-line, highly isolable, and 100%-reproducible defect on 2.23.0, independent of grouping, `mc:AlternateContent`, or position (inline vs. anchored).
2. **Grouped drawing children fall through to a generic "unsupported" path.** Per the diagnostic strings still present in the bundle, a shape renderer dispatches on a drawing "kind" (image / vectorShape / textboxShape / shapeGroup / chart), and anything it can't classify falls through to a generic placeholder/diagnostic path (`groupChildUnsupported`, `altContentNoSupportedChoice`). On an older release this path rendered a hatched placeholder box; it's plausible the same fail-closed path (or a related one) now renders nothing distinguishing (transparent) instead, which combined with the unfilled-shape-is-black default (point 1) could produce what looks like "solid black" even for shapes that aren't literally unfilled `custGeom` — i.e., the two defects may be compounding in the real document rather than operating identically. We could not confirm this compounding hypothesis in isolation within this pass's time box (see "Actual" above).
3. Both diagnostic codes and the hatched-placeholder CSS class remain in the 0.22.0 bundle verbatim, suggesting the underlying "I don't know how to render this drawing kind" detection logic is unchanged — what changed (across 2.20 → 2.21 → 2.23) is only which rendering path ultimately wins for a given input, or what it paints when it does.

## Suggested fix
Fix directions (from our analysis):
- Default an `<a:custGeom>` (and other vector shapes) with no `<a:fill>`/`<a:noFill>` element to **no fill** (transparent), matching the OOXML default and Word's own rendering, instead of opaque black.
- Re-examine whatever changed between 2.20 and 2.21 in the "unsupported drawing kind" fallback path (`groupChildUnsupported`/`altContentNoSupportedChoice`) — the hatched placeholder at least signaled "something is unsupported here"; whatever replaced it on 2.21+ should not be indistinguishable from a legitimate black-filled shape.
- Given our minimal isolated repro no longer reproduces the grouping-specific failure, prioritize reproducing against the real-structure fixture in this folder (`grouped-textboxes-po-overlay.docx`) directly, since it reliably shows the defect end to end.

**Possible workaround for integrators:** where the source document is known to come from a PDF→DOCX converter prone to this pattern, a pre-processing pass that inserts an explicit `<a:noFill/>` into any vector shape lacking a fill element would address the (currently dominant, 15-of-16-shapes) unfilled-shape sub-case before the document reaches the editor.

## Related
None.
