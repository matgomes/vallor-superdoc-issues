# SD-16 — `decide()` resolving on refusal instead of throwing — REPRODUCES (narrow)

## Update: reproduces on 2.23.0 (whole-document decide)

On `SD-03/paragraph-mark-deleted-twice.docx`, `doc.trackChanges.decide({decision:"accept", target:{kind:"all"}})` **resolves**
with `{"success":false,"failure":{"code":"INVALID_INPUT","message":"invalid-input"}}` instead of throwing (verified in the
browser via the harness `actions=1` "Accept all" button). The six single-change refusal shapes below all throw, so the
inconsistency is between whole-document and single-change decisions: a caller that relies on `try/catch` treats the refused
Accept All as a success. See also SD-03 and SD-17.

## Summary
Earlier notes claimed `trackChanges.decide()` can resolve `{success:false,
failure:{code,message}}` for a refused decision instead of rejecting the promise, which
would be a "phantom accept" risk: a caller that only checks "did the promise resolve"
would believe a change was decided when it wasn't. This was never previously reproduced
by script or in a browser (prior notes: "repro: none"). We tried six different refusal
shapes against `decide()` on 2.23.0 and every one of them **threw** instead of resolving
with `success:false`.

## Environment
superdoc 2.23.0 / `@superdoc/sdk` 2.20.0, headless SDK (`@superdoc/sdk`'s `createSuperDocClient`), Node.

## Steps to reproduce
`node SD-16/repro.mjs` against `_fixtures/dpa-multi-redline.docx`. The script tries, in
order: (1) deciding an already-decided id again, (2) deciding a nonexistent id, (3) a
`{kind:"ids"}` batch where one id is already decided, (4) a stale `expectedRevision`, (5)
deciding under an active `readOnly` editing restriction, (6) deciding only the `insert`
side of a replacement pair.

## Expected / Actual
- **Expected (per the old claim):** at least one of these resolves `{success:false,
  failure:{code,message}}`.
- **Actual on 2.23.0:** every one of them **throws** a rejected promise instead:
  - Double-decide: `Tracked change "<id>" has already been resolved.`
  - Nonexistent id: `No tracked change with id "<id>".`
  - Batch with an already-decided id: `No tracked change with id "<id>".`
  - Stale `expectedRevision`: `expected-revision <value> does not match current revision 1.`
  - `readOnly` protection and deciding one side of a replacement pair both **resolved
    successfully** rather than refusing at all — i.e. `protection.setEditingRestriction({
    mode: "readOnly" })` did not actually block `trackChanges.decide()` in this harness
    (a different, separate observation, not this issue's claim — noted under Related).

## Evidence
`repro.mjs` → `results-2.23.0.json` has the full attempt list with messages/receipts.

## Root cause / analysis
Not established. Every refusal path we could construct for `decide()` on 2.23.0 is a
validation-style rejection (bad/stale/already-resolved target), and those all throw
consistently. We could not find a scenario — in this harness, headless, no collaboration
— where `decide()` resolves a failure receipt instead. This may mean: (a) the original
claim applied to a code path we didn't trigger (e.g. a collaboration-specific refusal, or
a specific `COMMAND_FAILED`-style engine refusal like the ones seen elsewhere in this
project's research — `text-range-cross-table-cell`, `paragraph-tracked-wrapper-unsupported`
— which we did not attempt here because they apply to `blocks.delete`/`replace`, not
`decide`), or (b) the behavior was fixed since the original note was written, or (c) the
claim was a documentation/design concern rather than an observed runtime behavior (the
only source cited in prior research is an internal planning doc, not a production
sighting or error log).

## Suggested fix
Not applicable until reproduced. If the vendor can point to a `decide()` refusal shape
that resolves rather than throws, we can target it directly.

## Related
SD-14 (batch `{kind:"ids"}` decide throwing `TARGET_NOT_FOUND`-equivalent — consistent
with what we found here), SD-15 (id remapping across decisions, separately re-verified),
SD-106 (decide() only accepts `accept`/`reject`, no reinstate). Side finding worth a
separate look: `protection.setEditingRestriction({mode:"readOnly"})` did not block
`trackChanges.decide()` in this harness — out of scope for this report, flagged here for
awareness only.
