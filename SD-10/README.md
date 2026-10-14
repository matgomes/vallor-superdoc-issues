# SD-10 — Deleting a fully selected paragraph — FIXED on 2.23.0

## Summary

Historically, deleting a whole paragraph as a single structural unit — the equivalent of a
Word margin-click-drag selection, which captures the paragraph's trailing period and its
paragraph mark along with the text — was refused by SuperDoc, both headlessly
(`doc.blocks.delete` → `COMMAND_FAILED paragraph-tracked-wrapper-unsupported`) and in the
real editor (margin-drag + Backspace → `edit-rejected` / `backspace-context-unsupported`).
For a contract reviewer this meant: select an entire clause and press Delete/Backspace, and
nothing happens except an opaque error — the only workaround was to leave out the first
word or the trailing period. On superdoc 2.23.0 / `@superdoc/sdk` 2.20.0, **both** paths now
work correctly.

## Environment

| superdoc | headless `doc.blocks.delete` | browser UI (drag across mark + Backspace, suggesting mode) |
|---|---|---|
| 2.23.0 (`@superdoc/sdk` 2.20.0) | **FIXED** — succeeds, one tracked change | **FIXED** — succeeds, one tracked change, no error |
| 2.20.0 / 2.21.0 (prior investigation) | `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` | `edit-rejected` / `backspace-context-unsupported` |

Node 24, headless `@superdoc/sdk` for the API check; Playwright Chromium (headless) against
the bare harness page for the browser check. No integrator/Vallor code involved.

## Steps to reproduce

Run: `node SD-10/repro.mjs`

Fixture: `term-clause-plain.docx` (synthetic, copied from the shared anonymized fixture set
— 4 blocks: "Term" heading, the target paragraph "This Agreement will govern the
relationship for a period from the Start Date to the End (the Term). ACME may terminate
this Agreement with immediate effect at any time during the Term by notice in writing. ACME
will not be responsible to the Supplier for any costs which the Supplier may suffer as a
result of the termination." (326 chars), "Volume" heading, a closing paragraph).

### (a) Headless SDK

```js
doc.blocks.delete({ changeMode: "tracked", target: { kind: "block", nodeType: "paragraph", nodeId } });
```
on the full target paragraph block.

### (b) Browser UI

1. Open the fixture in the bare harness page, `mode=suggesting`.
2. Mouse-down just before "This Agreement", drag down past the end of the paragraph into
   the start of the next heading ("Volume") — a selection that spans the paragraph's
   trailing period and its paragraph mark, the way a margin-drag in Word would.
3. Press Backspace.

## Expected / Actual

**Expected:** the whole paragraph (including its mark) is deleted as one tracked change.

**Actual, on 2.23.0:**

(a) `doc.blocks.delete` **succeeds**: `success:true`, one tracked change
(`type:"deletion"`, `subtype:"text-deletion"`), exported OOXML contains the expected
`<w:del>` markers (2 — one for the run text, one for the paragraph mark). No error.

(b) The browser drag + Backspace **succeeds**: no `onException`/console errors captured
(`errorsAfterBackspace: []`), `trackChanges.list().total` goes 0→1. Screenshot
(`screenshots/03-after-backspace.png`) shows the full paragraph struck through and merged
into the following line, with a tracked-change card reading "Deleted" and the full
paragraph text.

## Evidence

- `results-2.23.0.json` — full script output for both passes.
- `screenshots/01-before-selection.png`, `02-after-drag-selection.png`,
  `03-after-backspace.png` — before, selection highlighted across the paragraph mark, and
  the struck-through result with the tracked-change card.

## Notes on the previous (2.20/2.21) investigation

The prior investigation found two *different* error codes for what looked like the same
bug: `COMMAND_FAILED paragraph-tracked-wrapper-unsupported` from the headless
`blocks.delete` call, and a separate `edit-rejected` / `backspace-context-unsupported` from
the real browser drag + Backspace path on this exact fixture — raising the question of
whether they were really the same root cause. Both are gone on 2.23.0, re-run with the same
fixture and the same selection geometry, which is consistent with (though does not prove)
a shared fix.

## Related

- SD-11 shared the same `paragraph-tracked-wrapper-unsupported` error code for a different
  trigger (a paragraph containing a Word REF cross-reference field) — see that folder for
  whether the same upstream change also affects that case.
