# SD-03 — SuperDoc writes a second `<w:del/>` into a paragraph mark's rPr, then refuses its own file on Accept All

## Summary

When a paragraph mark that is already tracked-deleted gets merged across again (e.g. a
user deletes a paragraph with tracking on, then later deletes across that same,
already-deleted boundary a second time), SuperDoc writes a **second** `<w:del/>` into the
paragraph mark's `<w:pPr><w:rPr>`. OOXML (`CT_ParaRPr`) allows at most one `w:ins`/`w:del`/
`w:moveFrom`/`w:moveTo` per paragraph mark. Once a document carries this doubled marker —
whether produced by SuperDoc itself or simply loaded from disk — `trackChanges.decide({decision:
"accept", target:{kind:"all"}})` throws `INVALID_INPUT` for the **entire document**, not just
the offending paragraph. For end users redlining contracts, Accept All fails outright with no
indication of which change is at fault; Reject All and single-change decisions still work, so
the failure looks random and intermittent.

## Environment

| superdoc | result |
|---|---|
| 2.23.0 (`@superdoc/sdk` 2.20.0) | **REPRODUCES** — read path and write path both confirmed |
| 2.20.0 / 2.21.0 (prior investigation) | reproduced identically |

Bare `@superdoc/sdk` (`createSuperDocClient({ runtime: "v2" })`), no collaboration, no
browser — Node 24, headless. No integrator code involved.

## Video

[`video/SD-03.mp4`](video/SD-03.mp4) (SuperDoc 2.23.0, Chrome, local harness). Accept all on a paragraph with a doubled paragraph-mark deletion returns `INVALID_INPUT`, so the three changes stay. Accepting the cards one by one clears them (3 → 1 → 0). Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

Run: `node SD-03/repro.mjs`

### (a) Read path — loading an already-doubled file breaks Accept All

1. Open `paragraph-mark-deleted-twice.docx` (synthetic fixture, a paragraph mark already
   carrying two `<w:del>` elements in its `rPr`).
2. Call `doc.trackChanges.decide({ decision: "accept", target: { kind: "all" } })`.

UI equivalent: open the document in the editor, click "Accept All" on the review ribbon.

### (b) Write path — SuperDoc's own `blocks.merge` writes the duplicate

1. Open `clean-base-four-paragraphs.docx` (synthetic, 4 plain paragraphs, no tracked
   changes).
2. `doc.blocks.merge({ changeMode: "tracked", first: <paragraph 2>, second: <paragraph 3> })`
   — tracked merge of two adjacent paragraphs. Produces exactly one
   `paragraph-mark-deletion` tracked change, as expected.
3. Call the **same merge again**, same two block ids (simulating a user repeating the
   paragraph-mark-delete action at a junction that's already tracked-deleted — e.g.
   pressing Backspace a second time at the same spot, or a chat/agent redline retrying).
4. `doc.trackChanges.list()` now reports **two** `paragraph-mark-deletion` entries instead
   of coalescing or rejecting the duplicate.
5. `doc.export.toDocx({ mode: "review-preserving" })` and inspect the OOXML.
6. Call `doc.trackChanges.decide({ decision: "accept", target: { kind: "all" } })` on this
   self-produced document.

UI equivalent: with tracking on, delete a paragraph (so its mark is tracked-deleted), then
select across that same paragraph boundary again and delete/merge a second time.

## Expected / Actual

**Expected:** either the second merge at an already-deleted boundary is rejected or
coalesced into the existing tracked change, and a document with a single marker per
paragraph mark always accepts cleanly; at minimum, a document-wide `decide({kind:"all"})`
should never fail because of one malformed paragraph when every other change is well-formed.

**Actual:**
- `trackChanges.list()` after the second merge: `["paragraph-mark-deletion",
  "paragraph-mark-deletion"]` (`total: 2`).
- Exported OOXML (`exported-2.23.0.docx`, `word/document.xml`) for the affected paragraph:
  ```xml
  <w:pPr><w:rPr>
    <w:del w:id="1" w:author="Probe" w:initials="P" w:authorEmail="probe@example.com" w:date="2026-10-14T00:46:06.229Z"/>
    <w:del w:id="2" w:author="Probe" w:initials="P" w:authorEmail="probe@example.com" w:date="2026-10-14T00:46:06.253Z"/>
  </w:rPr></w:pPr>
  ```
  Two self-closing `<w:del>` elements inside one `CT_ParaRPr`. (`w:authorEmail` is not part
  of the OOXML spec and is cosmetic — unrelated to the structural problem.)
- `doc.trackChanges.decide({ decision: "accept", target: { kind: "all" } })` throws on
  **both** the pre-built fixture and the self-produced export:
  ```
  code: INVALID_INPUT
  message: invalid-input
  ```
  with no indication of which tracked change is malformed, and no partial success —
  the whole document's Accept All fails.

## Evidence

- `results-2.23.0.json` — full script output (tracked-change subtypes before/after each
  merge, exported tag counts, decide() failures).
- `exported-2.23.0.docx` — SuperDoc's own export after the double-merge, containing the
  doubled `<w:del>` marker shown above (reproducible via
  `unzip -p exported-2.23.0.docx word/document.xml | grep -o '<w:del[^/]*/>'`, 2 matches).
- `trackChanges.list()` counts: 1 change after the first merge, 2 after the second
  (same boundary) merge — the second merge should not have added a change at all, or
  should have been rejected.

## Root cause / analysis

OOXML's `CT_ParaRPr` complex type (ECMA-376 §17.3.1.29) permits at most one child each of
`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo` — a paragraph mark records only one "this mark
was inserted/deleted/moved" state. SuperDoc's tracked `blocks.merge` writes a `w:del` into
the paragraph mark's `rPr` to record "this paragraph's mark was deleted" each time it runs,
without checking whether the mark already carries one. Deciding on the resulting document
walks every tracked change and (hypothesis, based on the failure being document-wide rather
than change-scoped) likely fails OOXML/model validation on the malformed paragraph mark
before it can act on any change, producing a single opaque `INVALID_INPUT` for the whole
document instead of a localized, change-scoped error.

## Suggested fix

- On write: when `blocks.merge` (or any other tracked operation that deletes a paragraph
  mark) targets a paragraph mark that already carries a `w:del`/`w:ins`/`w:moveFrom`/
  `w:moveTo`, either no-op (the mark is already tracked-deleted) or reject the operation
  with a specific, catchable error — never write a second marker into the same `rPr`.
- On read: `trackChanges.decide({kind:"all"})` should not fail the *entire* document
  because one paragraph mark is malformed. At minimum, surface which change/paragraph is
  invalid so a caller can skip it and decide the rest; ideally, treat a document with an
  already-malformed marker as auto-repairable (collapse to one marker) rather than an
  all-or-nothing failure.
- A general incoming/outgoing OOXML validator (SuperDoc has no document-wide
  normalizer/validator today, only narrow helpers like `contentControls.normalizeWordCompatibility`)
  would catch this class of bug at the boundary instead of leaving it for every future
  Accept All to trip over.

**Possible workaround** (integrator-side): detect and collapse duplicate paragraph-mark
revision markers into one on load, and fall back to deciding tracked changes one-by-one
(instead of `{kind:"all"}`) when a bulk decide fails, reporting how many were actually
applied.

## Note: one-by-one accept works, bulk accept doesn't (2.23.0)

On the doubled-marker document, accepting each change from SuperDoc's floating card (or deciding them one id at a time)
succeeds and leaves a clean document, while `decide({kind:"all"})` / Accept All refuses the whole document with
`INVALID_INPUT`. So the duplicate marker only breaks the bulk path, which is the button users reach for on large
documents. See also SD-17 (the bulk refusal emits no event).

## Related

- SD-04 — a different cause (duplicate `w:id` across distinct revision markers) also
  breaks `decide({kind:"all"})` with a hard failure for the whole document; same failure
  mode (one malformed marker, document-wide rejection), different root cause.
