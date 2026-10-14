# Shared fixtures

Real-world-shaped `.docx` files used by several `SD-xx` repros. All names, parties, addresses, numbers, places and authors are fictional; document structure (tracked changes, tables, text boxes, bookmarks, fields) is preserved because that is what triggers the bugs. Per-issue fixtures live in each `SD-xx/` folder.

| File | Pages | `w:ins` | `w:del` | Tables | Text boxes | Comments | Bookmarks |
|---|---|---|---|---|---|---|---|
| `bookmark-x1-plain.docx` |  | 0 | 0 | 0 | 0 | 0 | 0 |
| `bookmark-x2-around-text.docx` |  | 0 | 0 | 0 | 0 | 0 | 1 |
| `bookmark-x3-before-period.docx` |  | 0 | 0 | 0 | 0 | 0 | 1 |
| `bookmark-x4-from-heading.docx` |  | 0 | 0 | 0 | 0 | 0 | 1 |
| `bookmark-x5-split-runs.docx` |  | 0 | 0 | 0 | 0 | 0 | 0 |
| `dpa-multi-redline.docx` | 9 | 31 | 26 | 2 | 0 | 0 | 256 |
| `dpa-table-bearing-agreement.docx` | 9 | 0 | 0 | 1 | 0 | 0 | 106 |
| `dpa-table-cell-revisions.docx` | 9 | 3 | 2 | 1 | 0 | 0 | 106 |
| `dpa-tracked-stamped.docx` | 9 | 2 | 1 | 1 | 0 | 0 | 106 |
| `grouped-textboxes-po-overlay.docx` |  | 0 | 0 | 0 | 24 | 0 | 223 |
| `msa-200-pages-template.docx` |  | 0 | 0 | 32 | 0 | 0 | 2720 |
| `msa-multicountry-tracked-base.docx` | 6 | 1 | 12 | 3 | 0 | 0 | 165 |
| `msa-single-entity.docx` | 6 | 3 | 1 | 3 | 0 | 0 | 99 |
| `msa-supply-signed-style.docx` | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| `numbering-nostart-fixture.docx` |  | 0 | 0 | 0 | 0 | 0 | 0 |
| `tc-probe-00-clean-backspace-base.docx` |  | 0 | 0 | 0 | 0 | 0 | 0 |
| `tc-probe-06-replacement-table-cell-placeholder.docx` |  | 1 | 1 | 1 | 0 | 0 | 0 |
| `tc-probe-11-two-authors-same-paragraph.docx` |  | 2 | 2 | 0 | 0 | 0 | 0 |
| `tc-probe-12-deleted-table-row-text.docx` |  | 0 | 2 | 1 | 0 | 0 | 0 |
| `tc-probe-sd06-fixture.docx` |  | 0 | 2 | 0 | 0 | 0 | 0 |
