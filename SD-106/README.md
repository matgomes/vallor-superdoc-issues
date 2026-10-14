# SD-106 — No API to author a tracked change with a given author/date/id, or reinstate a decided one

## Summary
`TrackChangesApi` only exposes `list` / `get` / `decide`, and `decide` only accepts the
literal decisions `accept` and `reject` — there is no "undo this decision" / reinstate
operation. Every insert path (structural `create.*`, `clipboard.insert`) that can produce
a tracked change stamps it with the *caller's current session identity and the current
time*; none of them accept a caller-supplied author, date, or revision id. There is also
no way to import a raw OOXML fragment (e.g. an `altChunk`) carrying its own
`w:ins`/`w:del`/`w:id`/`w:author`/`w:date` intact.

## Why it matters
When a user undoes their own accept/reject of a counterparty's tracked change, the
"restored" change can only be re-created under the current user's name and today's date —
there is no way to put it back as *theirs*, dated when *they* made it. This matters
specifically for contract redlining: who proposed a change and when is part of the
negotiation record, and losing that attribution on every undo quietly rewrites history
every time a reviewer changes their mind.

## What we tried / closest APIs (superdoc 2.23.0 / `@superdoc/sdk` 2.20.0)
- `trackChanges` client surface is `list` / `get` / `decide` only (confirmed against the
  full `operationId` union in `node_modules/@superdoc/sdk/dist/generated/client.d.ts`).
- `trackChanges.decide({decision})` is validated at runtime, not just by (loose) type —
  verified live: `decision:"undo"` / `"reinstate"` / `"pending"` / `"undecided"` /
  `"reopen"` / `"unaccept"` all throw the identical error,
  `"track-changes decide:decision must be one of: accept, reject."` (see `repro.mjs`).
- `DocCreateParagraphParams` / `DocClipboardInsertParams` (same file) have no `author`,
  `date`, `id`, or `revisionId` field anywhere in their declared shape — only
  `changeMode`/`dryRun`/target-locator fields.
- Live-verified: `document.create.paragraph({ text, changeMode: "tracked" })` produces a
  tracked insertion whose `author` is the session's own display name (`"Probe"` in this
  harness) and whose `date` is the real wall-clock time at call time — not caller-supplied
  values.
- No `import`/`insertDocx`/`fromDocx`/`altChunk`-shaped operation exists anywhere in the
  operation catalog that would let a caller bring in a fragment with its own revision
  metadata preserved.

## Proposed API
- `trackChanges.decide({target, decision: "undo"})`, or a separate
  `trackChanges.reinstate({target})`, that reverts a prior accept/reject back to an open
  tracked change carrying its original author/date/id (not a fresh insertion under the
  caller's identity).
- An `author`/`date`/`id` (or a single `provenance: {author, date, id}`) option on the
  insert-producing operations (`create.*`, `clipboard.insert`) that originate a tracked
  change, honored only when the host's permission model allows attributing an edit to
  someone other than the current session user.
- An OOXML-fragment import operation (e.g. `blocks.insertFragment` /
  `clipboard.insertOoxml`) that preserves an incoming `<w:ins>`/`<w:del>`'s own
  `w:id`/`w:author`/`w:date` instead of re-authoring it.

## Evidence
`repro.mjs` → `results-2.23.0.json`. Fixture: `_fixtures/dpa-multi-redline.docx` (used
as-is, no modification).

## Related
SD-15 (a `decide()` call remaps other changes' ids with no reporting — a different
`decide()` gap, same API surface), SD-107 (positional/geometry gaps on the same
tracked-change entities).
