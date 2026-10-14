# SD-50 — `comments.create` INTERNAL_ERROR patch-precondition-failed (NEEDS REPRO on 2.23.0)

## Summary

Internally reported symptom: `doc.comments.create` / `ui.comments.createFromCapture` fail with
`INTERNAL_ERROR patch-precondition-failed` for some paragraph anchors while a near-identical
paragraph elsewhere in the same document works fine. If real, this would mean an integrator (or
an agent creating comments programmatically) cannot predict in advance which anchors are valid,
and comments bypass the plan/dry-run engine so there is no safe way to probe without creating real
comments. This report could **not** trigger the specific `patch-precondition-failed` error on
2.23.0 after trying several plausible structural variations — see below — so the verdict is NEEDS
REPRO.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: NEEDS REPRO** — could not trigger
  `INTERNAL_ERROR patch-precondition-failed` via script (this report).
- Not previously tested on 2.20.0/2.21.0 (no prior repro existed for this issue).
- Headless `@superdoc/sdk` (`harness/lib/sdk.mjs`), no browser, no collaboration.

## Steps to reproduce (attempted)

```bash
node SD-50/repro.mjs
```
Two fixtures, each with several paragraphs that are structurally similar but differ in one
dimension at a time, probing whether `doc.comments.create()` (`target: {kind:"text", blockId,
range:{start:0, end:<text length>}}`) succeeds for every one of them, called **sequentially**
against the same open document session (to avoid introducing a spurious revision race of my own):

**`near-identical-paragraphs.docx`** — first paragraph in the doc, a plain single-run paragraph, a
split-across-multiple-runs paragraph, the table itself, a paragraph immediately after a table, a
paragraph wrapping a bookmark, and the last paragraph in the doc.

**`near-identical-paragraphs-2.docx`** — two numbered-list items, an empty paragraph, a paragraph
containing a line break (`<w:br/>`) splitting two sentences across runs, and a paragraph
containing a `HYPERLINK` field (`fldChar begin/separate/end` + `instrText`).

## Expected / Actual

**Expected (if the bug reproduces):** at least one paragraph anchor fails with
`INTERNAL_ERROR` / `patch-precondition-failed` while a structurally similar one succeeds.

**Actual:** every ordinary paragraph anchor across both fixtures succeeded, including the
split-run paragraph, the bookmarked paragraph, the post-table paragraph, both list items, the
line-break paragraph, and the hyperlink-field paragraph. Two anchors failed, but with different,
expected, unrelated errors:
- The table's own block id (not a paragraph) → `TARGET_NOT_FOUND` ("Block ... not found") — a
  table isn't a text-anchorable block in the first place, not the reported bug.
- The empty paragraph (`range: {start:0, end:0}`, nothing to anchor to) → `INVALID_TARGET`
  ("target range could not be resolved to source bytes") — also an expected, different failure
  for a genuinely invalid (zero-length) range, not the reported bug.

No `INTERNAL_ERROR` or `patch-precondition-failed` appeared anywhere.

## Evidence

`results-2.23.0.json` (full raw output, both fixtures, every paragraph variant tried):

| fixture | anchor | result |
|---|---|---|
| 1 | first paragraph in doc | succeeded |
| 1 | plain single-run paragraph | succeeded |
| 1 | split-run paragraph | succeeded |
| 1 | the table itself | `TARGET_NOT_FOUND` (expected — not a text block) |
| 1 | paragraph after a table | succeeded |
| 1 | paragraph with a bookmark | succeeded |
| 1 | last paragraph in doc | succeeded |
| 2 | first numbered-list item | succeeded |
| 2 | second numbered-list item | succeeded |
| 2 | empty paragraph | `INVALID_TARGET` (expected — zero-length range) |
| 2 | paragraph with a line break | succeeded |
| 2 | paragraph with a hyperlink field | succeeded |

## Root cause / analysis

Not confirmed on 2.23.0. The original report described two "near-identical" real-document
paragraphs where one worked and one did not, without pinpointing the structural difference. The
variations tried here (run-splitting, bookmarks, table adjacency, list membership, line breaks,
hyperlink fields) are the most likely candidates for an anchor-resolution difference between two
superficially similar paragraphs, and none of them triggered the error — so whatever distinguished
the original pair is either a more specific structural feature not reproduced here (e.g. a
specific run-property combination, an `w:proofErr`/`w:noProof` marker, RTL text, a field other than
`HYPERLINK`, or revision/history state carried over from real edit history that a synthetic fixture
does not have), or it is data-dependent in a way not captured by structure alone (e.g. a particular
Unicode range, or a document that had previously gone through an accept/reject pass leaving
residual markup).

## Suggested fix

Not applicable until reproduced. If the vendor can identify the specific anchor structure that
triggers `patch-precondition-failed`, the general direction would be: `comments.create()` should
either succeed for any block that `blocks.list()` reports as a valid text-bearing node, or fail
with a specific, descriptive error identifying what about that anchor is invalid — not a generic
`INTERNAL_ERROR`.

**Possible workaround:** since comments bypass the plan/dry-run engine, an integrator cannot
pre-validate an anchor without risk of creating a stray comment on failure paths that partially
succeed. Using SuperDoc's own native comment composer UI (selection-driven) rather than
constructing anchors programmatically avoids the problem entirely, at the cost of not being usable
headlessly/by an agent.

## Related

None in this batch — exploratory finding, standalone.
