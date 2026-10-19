# SD-01 — In a collaboration room, `trackChanges.decide` fails with INVALID_CONTEXT for any tracked change after a footnote reference

## Summary

In a v2 collaboration room, accepting or rejecting a tracked change throws
`INVALID_CONTEXT` (`unsupported-context`) when the change sits **after a footnote reference in
the same paragraph**. Changes before the footnote reference in the same paragraph work, and the
same calls succeed when the document is opened without a room. Nothing is changed when it fails.

This is the trigger the original report was missing. Production saw `decide` fail in rooms on
payloads that worked outside them; a broad matrix without footnotes (below) never reproduced it.
Contracts use footnotes often, so any tracked change after one can't be accepted or rejected
by id in a room.

The tracked-change range reported for those changes is shifted one character left for each
footnote reference before it. The visible text counts the footnote reference as one character
(`￼`); the tracked-change offsets appear to count it as zero.

## Environment

- **`@superdoc/sdk` 2.20.0 (this repo's pin, with superdoc 2.23.0): REPRODUCES**, see
  [`footnote/results-sdk-2.20.0.txt`](footnote/results-sdk-2.20.0.txt).
- Also reproduced on `@superdoc/sdk` 2.21.0 and 2.22.0-next.11.
- Node 24, headless `@superdoc/sdk` (native host, runtime v2), bare `@hocuspocus/server` room
  (no persistence, no auth). No integrator code involved.

## Fixture

[`footnote/footnote-tracked-change.docx`](footnote/footnote-tracked-change.docx): one paragraph
with one footnote, one tracked insertion before the footnote reference (" thirty") and one after
it (" receipt of the"). Built by [`footnote/build-repro.py`](footnote/build-repro.py).

## Steps to reproduce

### Any document
1. Add a footnote to a sentence, turn on track changes, and insert or delete text after the
   footnote reference in the same paragraph.
2. Open the document in a collaboration room (Hocuspocus) and join it with a second participant.
3. Accept or reject that tracked change by id.
4. `INVALID_CONTEXT: unsupported-context` is thrown. A tracked change before the footnote
   reference in the same paragraph accepts normally.

### Script
```sh
node SD-01/footnote/repro.mjs SD-01/footnote/footnote-tracked-change.docx            # in a room
node SD-01/footnote/repro.mjs SD-01/footnote/footnote-tracked-change.docx --no-room  # no room
```
It prints the reported range of each change, then runs accept and reject on each, every time in a
fresh room (one participant creates it, a second joins and decides).

## Expected / Actual

Expected: accept and reject work for every tracked change, whatever comes before it in the paragraph.

Actual (`@superdoc/sdk` 2.20.0):

```text
paragraph: "Payment is due within thirty days￼ after receipt of the invoice."
change " thirty"          reported range 21-28 -> text there: " thirty"
change " receipt of the"  reported range 39-54 -> text there: "r receipt of th"   <- shifted by one

room    | accept " thirty"          -> success=true
room    | reject " thirty"          -> success=true
room    | accept " receipt of the"  -> INVALID_CONTEXT: unsupported-context
room    | reject " receipt of the"  -> INVALID_CONTEXT: unsupported-context
no room | accept " receipt of the"  -> success=true
no room | reject " receipt of the"  -> success=true
```

- The document and revision are left unchanged when it fails.
- `decide({ target: { kind: "all" } })` succeeds in the same room.
- Targeting by `ids` or `range` fails the same way as `id`, including a range with the offsets
  shifted to match the visible text.
- Reproduced with insertions and deletions, directly after the footnote reference and about 50
  characters after it.
- Tracked changes after a REF field or a bookmark in the same paragraph are not affected; only
  footnote references trigger it in our tests.
- A tracked change that contains the footnote reference itself accepts and rejects normally.

## Root cause / analysis

Every tracked change after a footnote reference reports a range shifted left by one per
preceding footnote reference. Our reading is that the collaboration path resolves the decision
against that shifted range, so it overlaps or misaligns with the footnote reference run and is
refused as `unsupported-context`. The no-room path succeeds with the same shifted range, so it
seems to resolve the change differently.

### Earlier matrix (none of these trigger it)

Fixtures: `dpa-table-cell-revisions.docx` (has 3 existing tracked changes, 2 of them inside
a table cell), `bookmark-x2-around-text.docx` (has a real bookmark, `BM_term`, wrapping an
entire paragraph), `dpa-table-bearing-agreement.docx` (has one table).

| operation | out-of-room | in-room (fresh room, single client) |
|---|---|---|
| `trackChanges.decide` by id | succeeds | succeeds |
| `trackChanges.decide` by range | succeeds | succeeds |
| `trackChanges.decide` all | succeeds | succeeds |
| `trackChanges.decide` on a change **inside a table cell** | succeeds | succeeds |
| `blocks.delete` (tracked) | succeeds | succeeds |
| `doc.replace` across a bookmark's marker (start inside the bookmark, end past it) | `COMMAND_FAILED text-range-in-bookmark: selection must preserve both bookmark markers.` | **identical** error, identical message |
| `doc.replace` scoped to one block ("text rewrite") | succeeds | succeeds |
| `tables.insertRow` | succeeds | succeeds |

Plus a **two-collaborator concurrent** scenario (not in the matrix table above): with two
clients ("Alice", "Bob") connected to the same room, Bob makes a tracked insert, then —
without waiting for Bob to disconnect — Alice calls `trackChanges.decide` on an unrelated
existing change. Both succeed (`bInsert.ok: true`, `aDecide.ok: true`).

`capabilities.resolve({ operationId, changeMode: "tracked" })` reported the same
`{available:{kind:"supported"}}` in every case, in-room and out-of-room — consistent with
the original report's observation that `capabilities()` never signals the restriction
either way.

The one failure found (`doc.replace` across a bookmark) is **not** in-room-specific — it
fails identically with and without collaboration, so it is a separate, legitimate
validation (`text-range-in-bookmark`), not evidence for this issue.

## Suggested fix

- Count a footnote reference as one position when mapping tracked-change offsets, matching the
  visible text. That would fix both the reported range and the in-room decision.
- Give in-room refusals a specific error code; `unsupported-context` is shared by several
  unrelated validators (see SD-11), so the string alone doesn't identify the cause.

## Related

- SD-02 — a related, confirmed (and since not-reproduced-on-2.20/2.21) collaboration/decide
  issue, same symptom family (decisions silently failing in a room).
- SD-11 — confirms `unsupported-context` is shared by at least one other, unrelated
  validator in this SDK version, supporting the hypothesis that the string itself is not
  diagnostic.
- SD-23 — a different, confirmed-fixed collaboration + tracked-mode restriction
  (`CAPABILITY_UNAVAILABLE` for table creation in collaboration), showing that
  collaboration-specific restrictions do exist in this codebase generally, even though this
  specific one didn't reproduce here.
