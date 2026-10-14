# SD-32 — `mode:"final"` export leaves table-structure and formatting revisions, with no warning

## Summary

`document.export.toDocx({mode:"final"})` — the supported "clean copy" export path — correctly
resolves plain text insertions/deletions (`w:ins`/`w:del`) but leaves every table-structure and
formatting revision element in the OOXML tracked-changes vocabulary completely untouched:
`w:cellIns`, `w:cellDel`, `w:cellMerge`, row-level `w:trPr>w:ins`/`w:del`, and the whole
`w:tblPrChange`/`w:trPrChange`/`w:tcPrChange`/`w:pPrChange`/`w:rPrChange` family. None of these
survivors are mentioned in `result.report.warnings`. For a contract-management product this means
a "clean"/"final" DOCX or PDF handed to a counterparty can still carry Word-visible revision
markup for anything beyond plain text edits — inserted/deleted/merged table cells, row-level
insert/delete, and tracked formatting changes — with the export's own report actively claiming
nothing is wrong.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0 (this repo's pinned versions): REPRODUCES.** Confirmed
  via both the headless SDK path (`document.export.toDocx({mode:"final"})`) and the real browser
  editor (`window.__sd.export({isFinalDoc:true})`).
- Prior notes (2.20.0/sdk 2.17, 2.21.0/sdk 2.18) found the same survival for `w:cellIns` alone,
  using a fixture (`tracked-no-rsid.docx`) that only exercised that one tag — see Related. This
  repro extends that to the full revision vocabulary on 2.23.0 with a purpose-built fixture.
- Browser/Node: Chromium via Playwright (headless), Node (this repo's pinned toolchain). Bare
  mount: `new SuperDoc(...)` in `harness/main.js`, no Vallor application code.

## Steps to reproduce

**UI steps (what a user does):**
1. Open a DOCX containing table-structure tracked changes (an inserted/deleted/merged table cell,
   a tracked-inserted or tracked-deleted table row, or a tracked formatting change on a table,
   row, cell, paragraph, or run) in SuperDoc.
2. Export/download the document as a "clean" or "final" copy (the editor's clean-export action,
   which calls `export.toDocx({mode:"final"})` under the hood).
3. Open the resulting DOCX in Word, or re-inspect `word/document.xml`: the table-structure and
   formatting revisions are still present and still rendered as pending changes.

**Script:**
```
node SD-32/repro.mjs
```
This builds on a fixture (`SD-32/fixture-table-revision-vocabulary.docx`) created by
`SD-32/make-fixture.mjs`, which starts from the repo's tiny synthetic scaffold
`tc-probe-06-replacement-table-cell-placeholder.docx` (one table, one plain `w:ins`/`w:del` pair)
and splices in one instance of each: `w:cellIns`, `w:cellDel` (+ a `w:tcPrChange` on the inserted
cell), a `w:cellMerge` pair (restart/continue), a tracked-inserted row (`w:trPr>w:ins`), a
tracked-deleted row (`w:trPr>w:del`), a row-property change (`w:trPrChange`), a table-property
change (`w:tblPrChange`), and a paragraph carrying both a paragraph-formatting change
(`w:pPrChange`) and a run-formatting change (`w:rPrChange`). The script then:
1. Opens the fixture headlessly via `@superdoc/sdk` and exports `{mode:"final"}`, counting every
   revision tag before/after via `harness/lib/sdk.mjs`'s `countTags()`.
2. Opens the same fixture in the real browser editor (`harness/main.js`), exports with
   `{isFinalDoc:true}` and with no flag (baseline), and counts the same tags.

## Expected / Actual

**Expected:** `mode:"final"` resolves every tracked-change element the same way it resolves plain
`w:ins`/`w:del` — to zero — or, if a given revision type can't be resolved, `report.warnings` says
so for that specific element.

**Actual (SDK, `mode:"final"`):**

| tag | before | after | resolved? |
|---|---|---|---|
| `w:ins` | 2 | 0 | yes |
| `w:del` | 2 | 0 | yes |
| `w:cellIns` | 1 | 1 | **no** |
| `w:cellDel` | 1 | 1 | **no** |
| `w:cellMerge` | 2 | 2 | **no** |
| `w:trPrChange` | 1 | 1 | **no** |
| `w:tblPrChange` | 1 | 1 | **no** |
| `w:tcPrChange` | 1 | 1 | **no** |
| `w:pPrChange` | 1 | 1 | **no** |
| `w:rPrChange` | 1 | 1 | **no** |

`result.report.warnings` contains exactly one entry, unrelated to any of the eight surviving
elements — it's the pre-existing `replacement-decomposed` warning about the scaffold's original
plain-text replacement (ids 115/116):

```json
[
  {
    "code": "replacement-decomposed",
    "message": "Tracked replacement is exported as Word-compatible delete and insert markup.",
    "feature": "trackedChanges",
    "severity": "warning",
    "affectedObjectId": "tc|main%3A%2Fword%2Fdocument.xml|replacement|sd%3Amain%3A%2Fword%2Fdocument.xml%7Cdel%7CJane%20Doe%7C2026-10-05T12%3A00%3A00Z%7C115%7CwId%3A115|sd%3Amain%3A%2Fword%2Fdocument.xml%7Cins%7CJane%20Doe%7C2026-10-05T12%3A00%3A00Z%7C116%7CwId%3A116",
    "affectedPartUri": "/word/document.xml",
    "canProceed": true
  }
]
```

No warning entry references any of the ids used for the eight new revision elements (9102–9111) —
their survival is completely unreported.

**Actual (browser, `isFinalDoc:true`):** identical tag counts before and after; the exported buffer
is byte-identical to the no-flag baseline export. This confirms the previously-filed SD-31 finding
(`isFinalDoc` is a no-op on the browser v2 path) — not a new finding in itself — but confirms it
holds for the full revision vocabulary, not just plain text and the single `w:cellIns` case
checked before.

## Evidence

- `SD-32/fixture-table-revision-vocabulary.docx` — the synthetic fixture (table 1, before counts
  above).
- `SD-32/sdk-final-export.docx` — SDK `mode:"final"` export output (after counts above).
- `SD-32/browser-baseline-export.docx` / `SD-32/browser-final-export.docx` — browser exports with
  and without `isFinalDoc:true` (byte-identical, MD5 not needed given exact buffer equality was
  asserted directly).
- `SD-32/results-2.23.0.json` — full before/after counts, warnings array, and browser comparison.
- `SD-32/screenshots/fixture-in-editor.png` — the fixture rendered in the bare SuperDoc editor.

## Root cause / analysis

*Hypothesis, based on observed behavior only (no SuperDoc source access):* the export engine's
"final" resolution pass appears to special-case plain-text tracked changes (`w:ins`/`w:del` runs)
and does not walk the table-structure or paragraph/run-property revision wrappers at all — neither
to resolve them nor to emit a warning for them. This is consistent with the previously-documented
partial fix at sdk 2.16/superdoc 2.19, which resolved plain text and (per that investigation) some
row-level revisions but left `w:cellIns` unresolved and unwarned; this fixture shows the same gap
extends to `w:cellDel`, `w:cellMerge`, and the entire `*PrChange` property-change family, none of
which were previously tested against a fixture that actually contained them.

## Suggested fix

The "final" export's revision-resolution pass should walk the full OOXML tracked-change element
set — not just `w:ins`/`w:del` text runs — and either resolve each table-structure/property-change
element to its accepted state, or, if a given element type is knowingly out of scope for automatic
resolution, surface a `report.warnings` entry naming it so the caller can decide whether the result
is safe to call "final". Right now `canProceed:true` is implied by omission for revision types the
export never even inspects, which is the more serious half of this bug — the host has no signal to
act on.

**Possible workaround:** an integrator could post-process the exported DOCX's `word/document.xml`
to detect and strip/resolve `w:cellIns`/`w:cellDel`/`w:cellMerge`/`*PrChange` elements before
treating an export as genuinely clean, or scan for their presence and block the "final" label if
any are found.

## Related

- SD-31 — the browser `isFinalDoc` flag is a no-op entirely (confirmed again here for the full
  revision vocabulary, not just plain text).
- SD-34 / SD-35 — other table-structure-revision-adjacent failures in collaboration sessions.
