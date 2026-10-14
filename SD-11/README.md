# SD-11 — Tracked delete of a paragraph containing a Word REF cross-reference field is refused

## Summary

A paragraph that contains a genuine Word `REF` cross-reference field (the kind produced by
Word's "Cross-reference" dialog, e.g. "see Section 2 above") cannot be deleted as a block,
whether tracked or direct, and cannot be deleted via a block range either. For a contract
reviewer, this means an agent- or UI-driven "delete this clause" action on a clause that
happens to contain a cross-reference to another clause fails outright, forcing a fallback
to deleting the clause's text some other way (which can leave an orphaned, empty numbered
heading behind after Accept All). Unlike the closely related SD-10 (deleting a whole
paragraph with no field), this restriction is **not fixed** on 2.23.0 — it reproduces
identically to the prior 2.20.0/2.21.0 investigation, confirming the restriction tracks the
presence of a field, not the paragraph's node type (plain paragraph vs. list item).

## Environment

| superdoc | `blocks.delete` (tracked) | `blocks.delete` (direct) | `blocks.deleteRange` across it |
|---|---|---|---|
| 2.23.0 (`@superdoc/sdk` 2.20.0), synthetic plain-paragraph fixture | **REPRODUCES** — `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` | **REPRODUCES** — same code | **REPRODUCES** — `COMMAND_FAILED unsupported-context` (code changed, see below) |
| 2.23.0, real-derived `listItem`-type fixture (`_fixtures/dpa-table-bearing-agreement.docx`, nodeId `518F9D2E`) | same | same | `COMMAND_FAILED unsupported-context` (same as synthetic) |
| 2.20.0 / 2.21.0 (prior investigation, `@superdoc/sdk` 2.17.0/2.18.0) | `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` | same | `COMMAND_FAILED text-range-in-field` |

Node 24, headless `@superdoc/sdk`, no collaboration, no browser. No integrator/Vallor code
involved.

## Video

[`video/SD-11.mp4`](video/SD-11.mp4) (SuperDoc 2.23.0, Chrome, local harness). Accepting the deletion leaves the orphaned "Indemnification" cross-reference text behind. The count goes back to 0. Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

Run: `node SD-11/repro.mjs` (rebuild the fixture with `node SD-11/make-fixture.mjs` if
`indemnification-cross-reference.docx` is missing; it is committed in this folder already).

### Fixture — built with a REAL field, through the SDK, no hand-authored OOXML

`indemnification-cross-reference.docx` (`make-fixture.mjs`):
1. `doc.create.heading({ text: "Indemnification" })`.
2. `doc.create.paragraph(...)` — "As provided in Section , the Supplier shall indemnify the
   Customer for any losses arising from a breach of this Agreement."
3. `doc.bookmarks.insert({ name: "Ref100001", at: <the heading> })` — a real bookmark.
4. `doc.fields.insert({ mode: "raw", instruction: "REF Ref100001 \\r \\h", at: <the gap
   after "Section "> })` — a real field referencing that bookmark.

Exported OOXML confirms a genuine field + matching bookmark, not literal text:
```xml
<w:fldSimple w:instr="REF Ref100001 \r \h"><w:r><w:t>Indemnification</w:t></w:r></w:fldSimple>
...
<w:bookmarkStart w:id="1" w:name="Ref100001"/> ... <w:bookmarkEnd w:id="1"/>
```
(`w:fldSimple` is a valid, real OOXML field representation, distinct from but equivalent to
the begin/instrText/separate/end "complex field" form seen in Word-authored documents — both
appear in real customer DOCX.) Note the bookmark name omits Word's own leading-underscore
convention for auto-managed cross-reference bookmarks (`_Ref100001`) because
`doc.bookmarks.insert` validates names must start with a letter and rejects a leading
underscore — a secondary, minor finding, not the subject of this report.

### Attempts (each against a fresh copy of the fixture)

1. `doc.blocks.delete({ changeMode: "tracked", target: <the REF paragraph> })`.
2. `doc.blocks.delete({ changeMode: "direct", target: <the REF paragraph> })`.
3. `doc.blocks.deleteRange({ changeMode: "tracked", start: <the REF paragraph>, end: <the
   next paragraph> })`.
4. (supplementary) a tracked **text**-range delete of only the field's rendered result text
   ("Indemnification"), not the whole paragraph, followed by `trackChanges.decide({decision:
   "reject", ...})` on that change.

## Expected / Actual

**Expected:** either the paragraph can be deleted (tracked or direct) like any other, or it
is refused with a clear, stable, specific error.

**Actual:**

| call | result |
|---|---|
| `blocks.delete` (tracked) | `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` |
| `blocks.delete` (direct) | `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` — **not tracked-mode-specific**; the node cannot be block-deleted at all while it contains a field |
| `blocks.deleteRange` (REF paragraph through the next paragraph) | `COMMAND_FAILED unsupported-context` |
| tracked delete of only the field's result text | **succeeds**, one `text-deletion` tracked change |
| rejecting that tracked deletion | **succeeds** |

So the restriction is narrow and specific: a field-bearing paragraph cannot be removed as a
*block* (by either delete API), but its field's rendered text can be edited and the edit can
be tracked and rejected normally. Cross-checked against a second, real-derived fixture
(`_fixtures/dpa-table-bearing-agreement.docx`, a `listItem`-type paragraph with a real `REF`
field from the DPA corpus, nodeId `518F9D2E`) — identical results on both `blocks.delete`
calls and `blocks.deleteRange`, confirming the restriction tracks field presence, not
paragraph vs. list-item node type.

## Evidence

- `results-2.23.0.json` — full script output for all four checks.
- Exported fixture OOXML excerpt above (genuine `w:fldSimple` + matching bookmark).

## Root cause / analysis

The same "paragraph-tracked-wrapper" guard investigated in SD-10 still applies whenever the
target paragraph contains a field node, regardless of whether the delete is tracked or
direct — this is a stricter, unconditional refusal (hypothesis: the wrapper that would
represent "this whole paragraph is gone" can't also represent "and it used to contain a
field," so the engine refuses rather than silently dropping the field). `blocks.deleteRange`
hits a second, independent guard against the field's content, whose error message changed
between sdk versions (`text-range-in-field` → `unsupported-context`) without any functional
change — consistent with SD-01's observation that `unsupported-context` is shared by
multiple unrelated internal predicates in this SDK version and is not part of a documented,
stable error taxonomy.

## Suggested fix

- Allow block-level deletion of a paragraph that contains a field: either delete the field
  along with the paragraph (the expected behavior — deleting a clause should delete
  everything in it, including any cross-references it makes), or at minimum make a
  tracked-mode deletion wrap the field the same way `w:ins`/`w:del` already wrap plain runs.
- Return a specific, stable, documented error code for "can't delete a paragraph/range that
  contains a field" rather than reusing the generic, overloaded `unsupported-context`
  string that several unrelated validators also throw (see SD-01).

**Possible workaround** (integrator-side): before a block-level delete, detect whether the
target range contains a field; if so, delete the field's result text first (confirmed to
work and to be trackable/rejectable above), then retry the block/range delete.

## What the user sees (manual, 2.23.0, Chrome)

Open `harness/index.html?doc=SD-11/indemnification-cross-reference.docx&mode=suggesting`, select the paragraph
"As provided in Section Indemnification, the Supplier shall indemnify…", and press Backspace.
Every word becomes a tracked deletion **except the cross-reference result "Indemnification"**, which stays unstruck, even though
the tracked-change card says the whole sentence was deleted. Accept the change from the card: the paragraph goes, but an
orphaned line containing only "Indemnification" is left behind. This is the "deleting a clause leaves messy formatting"
symptom users reported.

## Related

- SD-10 — the same `paragraph-tracked-wrapper-unsupported` error code, same error family,
  but for a plain paragraph with **no** field: that case is now fixed on 2.23.0, which is
  what let us isolate that this restriction specifically tracks field presence.
- SD-01 — documents `unsupported-context` as a single string shared across (at least) six
  unrelated internal predicates; this issue's `blocks.deleteRange` failure is one more
  reported instance of that string, now appearing here where 2.20/2.21 reported
  `text-range-in-field` for the identical operation.
