# SD-39 — Bookmark end-marker refused at a paragraph's exact text length — NOT REPRODUCED for real paragraphs on 2.23.0

## Summary
Earlier notes claimed `bookmarks.insert()` refuses placing the end marker exactly at a
paragraph's text length for "some Word-authored paragraphs" but accepts length-1, worked
around by `placeWholeParagraphBookmark` retrying at `textLength - 1`. Sweeping 587 real
paragraphs across 10 fixtures (5 synthetic bookmark-edge-case documents plus 5 real,
multi-page Word-derived contracts) on 2.23.0 found this exact asymmetry only on
single-character, blank/empty paragraphs (just a line-break marker, `text: "\n"`) — never
on a single substantial (≥10-character) real paragraph.

## Environment
superdoc 2.23.0 / `@superdoc/sdk` 2.20.0, headless SDK, no browser.

## Steps to reproduce
For every non-table paragraph with non-empty text in each fixture: find its exact text
length `L` via `blocks.list({includeText:true})`, then call `bookmarks.insert` with
`end: L` and separately with `end: L - 1`, and record whether each succeeds or fails.

`node SD-39/repro.mjs` — tests `bookmark-x1` through `bookmark-x5` plus
`msa-single-entity.docx`, `dpa-tracked-stamped.docx`,
`tc-probe-11-two-authors-same-paragraph.docx`,
`guide-sample.docx (not shipped)`, `msa-supply-signed-style.docx` (10
fixtures, 587 paragraphs total).

## Expected / Actual
- **Expected (per the old claim):** at least one real, substantial paragraph shows
  `end:L` refused / `end:L-1` accepted.
- **Actual on 2.23.0:** 0 of 587 paragraphs ≥ 10 characters showed this pattern. The
  **only** 3 matches found were single-character (length 1) blank/empty paragraphs whose
  text is just `"\n"` — a degenerate case, not "some Word-authored paragraphs" in the
  sense of real paragraph content:
  - `msa-single-entity.docx` block `2349F7A5` (len 1): `end=1` →
    `Unable to place the bookmark end marker at offset 1 (invalid-range).`; `end=0` → OK.
  - `dpa-tracked-stamped.docx` block `2B6C3E33` (len 1): same pattern.
  - `guide-sample.docx (not shipped)` block `1B19FD69` (len 1): same pattern.
  - All other 584 paragraphs (lengths from 2 to several hundred characters, across both
    synthetic and real Word-derived documents) accepted `end:L` without needing the
    `L-1` fallback.

## Evidence
`repro.mjs` → `results-2.23.0.json` (full per-paragraph results for all 587 paragraphs).

## Root cause / analysis
The reproducible pattern we found is much narrower than originally described: a
single-character, effectively-empty paragraph (likely a bare paragraph-mark-only
paragraph with no real run content) refuses a bookmark spanning its one character
(`invalid-range`) but accepts a zero-length (collapsed) bookmark at its start. That is a
plausible, understandable edge case on its own — an "empty" paragraph may not have a
valid end-of-range position at offset 1 — but it is a different and much narrower bug
than "some Word-authored paragraphs" refusing a bookmark at their real text length, which
we could not find on any paragraph with actual content.

## Suggested fix
Not applicable for the original (broader) claim — not reproduced. If the degenerate
single-character-paragraph case above is worth fixing on its own, `bookmarks.insert`
should accept an end offset equal to a paragraph's reported text length regardless of
whether that paragraph is empty/whitespace-only.

## Related
SD-40 (bookmarks.insert ignoring `coordinateSpace:"tracked"` / refusing offsets inside a
deletion — a different bookmarks.insert gap, not re-verified here).

_Note: `results-2.23.0.json` was captured over a larger internal fixture set; some of those files are not shipped in this repo. Re-running `repro.mjs` sweeps the fixtures that are in `_fixtures/`._
