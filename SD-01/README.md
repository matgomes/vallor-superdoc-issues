# SD-01 — Any v2 collaboration room blocks "byte-apply" mutations with INVALID_CONTEXT — NEEDS REPRO on 2.23.0

## Summary

Earlier production investigation reported that, inside a v2 collaboration room,
structural mutations and `trackChanges.decide` sometimes fail with
`{code:"INVALID_CONTEXT", message:"unsupported-context"}` on the exact payload that
works fine outside a room, even though `capabilities()` still reports the operation as
available. A narrow first pass (2 operations) on 2.20.0/2.21.0 did not reproduce it. This
pass runs a much broader matrix — 8 distinct operations across decide-by-id/range/all,
block structural edits, a bookmark-crossing replace, a scoped text rewrite, table-row
insertion, and accepting a change located inside a table cell, each both outside and inside
a bare Hocuspocus room, plus a two-collaborator concurrent-edit scenario — on superdoc
2.23.0 / `@superdoc/sdk` 2.20.0. **None of the 8 operations, and the two-collaborator
scenario, reproduced `INVALID_CONTEXT` or any in-room-only failure.** Per the brief's
verdict rules, this is reported as **NEEDS REPRO**, not FIXED: we still only have the
original production symptom (real error strings, Sentry-adjacent context) and no reliable
trigger, on this version or the two before it.

## Environment

Node 24, headless `@superdoc/sdk`, a bare `@hocuspocus/server` 2.15.3 room (no persistence
extension, no auth) via the shared `harness/lib/collab-server.mjs` helper. No integrator
code involved.

## Matrix tried (each operation run twice: out-of-room, then fresh in-room)

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

## Verdict

**NEEDS REPRO.** Across 8 operations × 2 contexts, plus a concurrent two-collaborator
variant, nothing produced `INVALID_CONTEXT` or any room-only failure on 2.23.0. This
matches the earlier (narrower) 2.20.0/2.21.0 finding and extends it substantially — the
non-reproduction is no longer just "2 ops tried," but now also covers table-cell decides,
table-row structural edits, cross-paragraph scoped replace, and concurrent multi-client
access.

## What we know from production (for the vendor)

- Symptom: `trackChanges.decide` and other structural mutations fail
  `{success:false, failure:{code:"INVALID_CONTEXT", message:"unsupported-context"}}` inside
  a v2 collaboration room, on payloads that work identically outside a room.
  `accept_tracked_changes` (no args) reportedly succeeded 0/5 times in-room vs. 5/5
  out-of-room in one observed incident.
- `doc.mutations.apply` is understood (from source-level investigation, not confirmed here)
  to route through a patch-apply entrypoint gated on `performByteApply === false` plus a
  "fenced" (source-backed) main story; the collaboration transport is believed to always
  supply `performByteApply:false`.
- `unsupported-context` is not unique to this failure — this investigation and SD-11 both
  found the same string attached to unrelated validators (a field/bookmark text-range
  guard, in SD-11's case) in this very SDK version, so the string alone is not a reliable
  signature of this specific bug.
- Historical context: at one point this was misattributed to "reconstructed-looking" change
  ids on one specific document; a later release note mentioned "delete across section
  boundaries and explain rejected edits" with no retest recorded.

## Suggested fix (for when this can be reproduced)

- A stable, specific error code (not the shared `unsupported-context` string) for whatever
  in-room-only restriction actually exists, so a caller — and a bug report — can tell it
  apart from the five-plus other things that currently throw the same message (see SD-11).
- `capabilities()` should reflect any in-room-only restriction rather than reporting
  `available:true` unconditionally.

## Possible next steps to actually reproduce this

- Try the exact production document(s)/payload that triggered the original incident,
  rather than our synthetic/anonymized fixtures — the original symptom may depend on
  specific document content (e.g. the "reconstructed-looking" ids mentioned in the
  historical note) that these fixtures don't carry.
- Try section-boundary-crossing operations specifically (a release note mentioned
  "delete across section boundaries" as a related fix — not covered in this matrix since
  none of our fixtures have multiple sections).
- Try a longer-running room (minutes, not seconds) with more collaborators and more
  concurrent edits, in case the restriction is about accumulated room state rather than
  the first operation in a fresh room.

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
