# SD-26 — Scoped replace (`by:"target"`) — FIXED on 2.23.0 / sdk 2.20.0

Part of the deleted-text group: SD-06, SD-07, SD-08, SD-25, SD-40 (this issue is listed alongside that group as a related, MEDIUM-priority tracking issue, not a member of it).

## Verdict: FIXED

Originally filed against **superdoc 2.9.0 / @superdoc/sdk 2.6.0 / docx-engine
0.8.0**. On **superdoc 2.23.0 / @superdoc/sdk 2.20.0**, the exact defect
described — a scoped one-word replace striking and reinserting the whole
sentence instead of the word, and `DISPATCH_ERROR` for a selector-scoped
call — **does not reproduce**. A real word-level scoped replace now works
end to end.

## Original issue (for reference)

- **Issue A:** `replace_text` with `selector:{kind:"nodeId"}` → `DISPATCH_ERROR: v2 text.rewrite currently requires a ref produced by query.match/find or a single text selector`.
- **Issue B:** changing "Provider" → "Vendor" struck and reinserted the entire sentence (no word-level granularity).
- **Why (at the time):** the engine only routed `by:"block"` and `by:"select"` for `text.rewrite`; `by:"target"` wasn't wired, and the SDK's `parseScopedReplaceArgs` emitted exactly that unrouted shape.

## Steps run on 2.23.0 / sdk 2.20.0

Fixture: paragraph 1 of `_fixtures/tc-probe-00-clean-backspace-base.docx`, replaced (directly, untracked) with the sentence `"The Provider shall deliver the goods on time."`.

1. Call the SDK's agent action runtime directly (`superdocPerformAction` from `@superdoc/sdk`'s `dist/agent/actions.js`, the same entry point `createAgentToolkit`/MCP tool calls use) with:
   ```js
   {
     action: "replace_text",
     selector: { kind: "nodeId", nodeId: "00000001" },
     edits: [{ find: "Provider", replace: "Vendor" }],
     changeMode: "tracked",
   }
   ```
2. Inspect the result, the resulting paragraph text, and `trackChanges.list()`.
3. For comparison, also call the pre-`edits`-array legacy shape (`selector` plus top-level `find`/`replace` strings, no `edits` array) to see how that's handled now.

Script: `node SD-26/repro.mjs`.

## Result

- Step 1 **succeeds**: `status:"ok"`, `editsApplied:[{find:"Provider", occurrences:1}]`, `postText:"The Vendor shall deliver the goods on time."` — no `DISPATCH_ERROR`.
- The resulting tracked change is exactly **one word**: `trackChanges.list()` reports a single `replacement`/`text-replacement` change with `deletedText:"Provider"`, `insertedText:"Vendor"` — the rest of the sentence (`"The "`, `" shall deliver the goods on time."`) is untouched and carries no tracked-change marks.
- Step 3 (the old, pre-fix argument shape) is now rejected outright with a clear `INVALID_ARGUMENT`, `message: 'replace_text requires a non-empty "edits" array of {find, replace}'` — rather than silently falling through to a whole-paragraph rewrite or the old `DISPATCH_ERROR`.

Full raw output: `results-2.23.0.json`.

## Analysis

The SDK's `replace_text` action now has a `parseScopedReplaceArgs` path that
is genuinely wired: given a `selector` that resolves to exactly one block
plus a non-empty `edits` array, it resolves per-`find` spans inside that one
block and applies a `doc.mutations.apply` plan with one `text.rewrite` step
per matched span — producing a real word-level tracked change, not a
whole-paragraph replace. This appears to be new functionality relative to
the 2.9.0/sdk 2.6.0 version originally tested (which had no such scoped,
per-span resolution step for `by:"target"`-style selectors) rather than a
narrow fix to the original code path.

## Related

Tracking-adjacent to the deleted-text group (SD-06, SD-07, SD-08, SD-25,
SD-40) and to SD-20 (agent `changeMode` handling), but not itself about
deleted text.
