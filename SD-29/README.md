# SD-29 — `doc.diff.compare()` silently ignores `sourceSnapshot`, always diffs the live document against `targetSnapshot`

## Summary
`document.diff.compare({sourceSnapshot, targetSnapshot})` is documented (by the natural
reading of its two-snapshot parameter shape) to compare those two snapshots against each
other. Instead, it always diffs the *live, current* document state against
`targetSnapshot` and ignores `sourceSnapshot` entirely. Passed in the natural order
(`sourceSnapshot: before, targetSnapshot: after`, with the live document currently in the
`after` state), this reports `hasChanges:false` right after a real edit — a false
"nothing changed."

## Environment
- **2.23.0** (this report): **reproduces**, same as prior findings on 2.20/2.21.
- `@superdoc/sdk` 2.20.0.
- Headless SDK, no browser/collaboration involved.

## Steps to reproduce
1. Open a document (`_fixtures/bookmark-x1-plain.docx`, a short plain-text fixture).
2. Capture a snapshot: `const before = await document.diff.capture()`.
3. Make a real edit: replace the text of a paragraph (`document.replace(...)`).
4. Capture another snapshot: `const after = await document.diff.capture()` — its
   `fingerprint` differs from `before`'s, confirming the edit registered.
5. Call `document.diff.compare({ sourceSnapshot: before, targetSnapshot: after })` (the
   natural reading: "what changed going from `before` to `after`").
6. For contrast, also call it reversed (`{ sourceSnapshot: after, targetSnapshot: before
   }`) and with only `targetSnapshot` set (no `sourceSnapshot` at all), in both snapshot
   orders.

`node SD-29/repro.mjs`.

## Expected / Actual
- **Expected:** step 5 (natural order) reports `hasChanges:true` — the document changed
  between those two snapshots.
- **Actual:** step 5 reports `hasChanges:false`, with `baseFingerprint === targetFingerprint`
  both equal to the **target** (`after`) snapshot's fingerprint — i.e. `sourceSnapshot` was
  silently ignored and the live document (currently in the `after` state) was diffed
  against `targetSnapshot` (also `after`), so of course nothing differs.
- The **reversed** order (`sourceSnapshot: after, targetSnapshot: before`) correctly
  reports `hasChanges:true`, because now the ignored `sourceSnapshot` doesn't matter — the
  live document (`after`) is being correctly diffed against `targetSnapshot: before`.
- Passing only `targetSnapshot` (no `sourceSnapshot` field at all, which is the shape the
  generated `DocDiffCompareParams` type actually declares —
  `node_modules/@superdoc/sdk/dist/generated/client.d.ts`, `DocDiffCompareParams` only has
  `targetSnapshot`, no `sourceSnapshot`) behaves identically to the reversed case:
  `{targetSnapshot: before}` → `hasChanges:true`; `{targetSnapshot: after}` →
  `hasChanges:false`. This confirms the implicit source is always the live document, and
  `sourceSnapshot` isn't part of the real contract at all — it's accepted as an extra,
  silently-ignored property (the SDK doesn't validate against unknown input keys here).

## Evidence
`repro.mjs` → `results-2.23.0.json`. Fixture used as-is from `_fixtures/`
(`bookmark-x1-plain.docx`).

## Root cause / analysis
`doc.diff.compare()`'s real contract is "diff the live document against `targetSnapshot`"
— a one-snapshot API, not a two-snapshot one, matching its generated type. Any caller who
reads the parameter name `sourceSnapshot` and assumes it's honored (a reasonable reading
given the parameter exists and is accepted without error) gets silently wrong answers
whenever their source snapshot isn't also the document's current live state.

## Suggested fix
Either (a) reject `sourceSnapshot` as an unknown/unsupported parameter instead of silently
accepting and ignoring it, or (b) implement true two-snapshot comparison so the parameter
does what its name says. Documentation should state unambiguously that `compare()` only
takes a `targetSnapshot` and always diffs against the live document.

## Related
None additional beyond the general documentation-accuracy pattern (see SD-89, out of
scope for this folder).
