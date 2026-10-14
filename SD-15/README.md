# SD-15 — A `trackChanges.decide()` call silently invalidates another, undecided change, and the receipt never says so

## Summary
Deciding one tracked change can resolve a *second*, different tracked change as a side
effect (both halves of a paragraph-mark merge, in this repro), but the decide receipt only
ever reports the id you explicitly targeted — never the id of the other change it also
consumed. A caller that lists the open changes once and then loops through that captured
id list (a natural "accept all N remaining changes" implementation) will hit
`TARGET_NOT_FOUND` on the second id, because it was already resolved behind the scenes.
This matters directly for contract review: any bulk accept/reject flow built on a
once-captured id list can fail partway through with no warning, leaving some changes
undecided and the caller unable to tell why without re-deriving state from scratch.

## Environment
- superdoc 2.23.0 / `@superdoc/sdk` 2.20.0 (pinned in this repo) — **reproduces**.
- Node `@superdoc/sdk` runtime (`harness/lib/sdk.mjs`), no browser/collaboration involved.
- Not independently re-checked against 2.20.0/2.21.0 in this pass; prior notes describe
  the same symptom informally without a concrete repro.
- Note: a fixture with only independent/replacement-pair tracked changes (no linked
  structural pair) does **not** show this — e.g. deciding all 37 open changes in
  `_fixtures/dpa-multi-redline.docx` sequentially, without re-listing, completes with zero
  failures. The bug specifically needs two tracked changes that are internally linked; see
  below.

## Steps to reproduce
UI-equivalent: open a document with several open tracked changes, including two
paragraph-mark-merge changes on the same paragraph (e.g. a deleted paragraph break that
merges two paragraphs together, tracked). Capture the full "open changes" list once (as a
review panel typically would), then accept/reject them one at a time from that captured
list without re-querying the document between decisions.

Script:
```
node SD-15/repro.mjs
```
1. Open `SD-15/fixture.docx` (a copy of `_fixtures/msa-multicountry-tracked-base.docx`;
   6 open tracked changes, including a paragraph-mark-merge pair on the same block).
2. `trackChanges.list({limit:200})` once; capture the 6 ids in order.
3. Loop `decide({target:{kind:"id", id}, decision:"accept"})` over the captured ids,
   without re-listing.
4. Compare against a control loop that re-lists before every decision.

## Expected / Actual
**Expected:** either (a) the receipt for deciding one change in a merge pair lists the
companion change's id under `invalidatedRefs` / `remappedRefs` so a caller can drop it
from its own pending-work list, or (b) the companion change remains independently
decidable afterward.

**Actual:** the receipt for `48ebbb1d6c05dbf3c7f7f2bc` (a "paragraph mark deletion
(merge)" structural change) reports only itself in `invalidatedRefs` and an empty
`remappedRefs`:
```json
{
  "removed": [{"kind":"entity","entityType":"trackedChange","entityId":"48ebbb1d6c05dbf3c7f7f2bc"}],
  "invalidatedRefs": [{"kind":"entity","entityType":"trackedChange","entityId":"48ebbb1d6c05dbf3c7f7f2bc"}],
  "remappedRefs": []
}
```
Yet the very next captured id, `6f8cba0257a9f5ead0946f45` — the OTHER half of the same
paragraph-mark merge, on the same `blockId` — immediately fails:
```
TARGET_NOT_FOUND: No tracked change with id "6f8cba0257a9f5ead0946f45".
```
A post-loop re-list confirms both ids are gone — the single `decide()` call resolved both
halves of the merge, it just never told the caller about the second one. The control loop
(re-listing before every decision) completes all 6 changes cleanly, because by the time it
reaches that paragraph it finds only one change left to decide instead of two stale ones.

## Evidence
Full output in `results-2.23.0.json`. Key excerpt — the no-relist loop:

| index | id (abridged) | type | result |
|---|---|---|---|
| 0 | `685762e8…` | deletion | accepted |
| 1 | `48ebbb1d…` | structural (paragraph mark deletion, merge) | accepted — `invalidatedRefs` lists only itself |
| 2 | `6f8cba02…` | structural (paragraph mark deletion, merge) — **same blockId as #1** | **`TARGET_NOT_FOUND`** |
| 3 | `8b715112…` | insertion | accepted |
| 4 | `bd2c1608…` | formatting | accepted |
| 5 | `3372a1e6…` | deletion | accepted |

The re-list control loop decides all 6 original changes with no failures (it naturally
skips the already-resolved id because the fresh `list()` only returns 5 remaining items
after step 1, not 6).

## Root cause / analysis
Hypothesis: a tracked paragraph-mark merge is represented internally as a pair of linked
structural revisions (both anchored to the same `blockId`, both excerpted as "paragraph
mark deletion (merge)" in `trackChanges.list()`), but `trackChanges.decide()` resolves the
pair as one atomic unit while only reporting the id that was explicitly targeted in its
`invalidatedRefs`. The documented purpose of `invalidatedRefs`/`remappedRefs` appears to be
exactly this — telling a caller which other ids are no longer valid or have moved — but in
this case the companion id is silently omitted rather than included.

## Suggested fix
When resolving a tracked change also resolves a linked/paired change as a side effect
(merge pairs, replacement pairs, or any other internally-linked revision group), the
decide receipt's `invalidatedRefs` should include every id that became invalid as a
result — not only the id that was explicitly targeted. Until then, any caller holding a
captured id list must treat every `TARGET_NOT_FOUND` as "re-fetch the full list and
continue," never as a hard failure, and should never fire a batch of decisions in
parallel against a once-captured list.

**Possible workaround:** re-list the open tracked changes before every single decision
(as the control loop in this repro does), or treat `TARGET_NOT_FOUND` during a bulk
decide loop as "already resolved, skip" rather than a fatal error.

## Related
SD-16 (decide() can resolve instead of throw on a different refusal shape), SD-07 (a
related "paragraph-level changes aren't reported by id-based APIs the way a caller
expects" issue in Vallor's own integration, informally analogous to this gap).
