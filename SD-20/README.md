# SD-20 — `changeMode` silently defaults to direct when omitted, on a tracked-capable agent action

Tracking-adjacent to the deleted-text group (SD-06, SD-07, SD-08, SD-25, SD-40) — this issue is about agent-driven edits losing track-changes attribution, not about deleted text specifically.

## Summary

SuperDoc's agent action runtime (`superdocPerformAction`, the entry point
behind `createAgentToolkit`/MCP tool calls) silently defaults an action's
`changeMode` to `"direct"` whenever the caller omits it — even for actions
the SDK's own capability table reports as fully tracked-capable. In a
product where every AI-driven edit is expected to be a reviewable tracked
change, this means an agent call that simply forgets to pass `changeMode`
produces an untracked, silently-applied edit with `status:"ok"` and no
signal that attribution was lost.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: REPRODUCES** (changeMode silently defaults to direct when omitted).
- Previously tested on sdk 2.17.0 and 2.18.0 (prior internal notes): same defect, byte-identical `dist/agent/actions.js` fallback sites.
- Headless `@superdoc/sdk` (`createSuperDocClient({runtime:"v2"})`) calling `superdocPerformAction` directly — no browser needed.

## Steps to reproduce

Fixtures: `plain-paragraph.docx` (a single plain paragraph, from the shared `_fixtures/` corpus) and `multi-redline-table.docx` (a document with 2 tables and existing comment/bookmark annotations, `_fixtures/dpa-multi-redline.docx`).

1. Call `getActionDispositions()` (exported from `@superdoc/sdk`) and check the disposition for `apply_style` and 11 other previously-flagged actions.
2. Grep the SDK's own `dist/agent/actions.js` for the `?? 'direct'` fallback pattern and note the line numbers.
3. Call `superdocPerformAction(doc, {action:"apply_style", selector:{...}, headingLevel:2, changeMode:"tracked"})` — explicit tracked mode.
4. Call the identical action again on a fresh copy, omitting `changeMode` entirely.
5. Call `superdocPerformAction(doc, {action:"move_table", ...})` on a table carrying comment/bookmark/permission anchors, for comparison with a known *explicit* capability gate (not a changeMode issue).

Script: `node SD-20/repro.mjs`.

## Expected / Actual

**Expected:** an action the capability table reports as `"tracked"` either requires `changeMode` or defaults to the host's configured default change mode — never silently to `"direct"`.

**Actual:**
- `getActionDispositions()` reports **all 41** actions, including `apply_style`, as disposition `"tracked"` (same count and classification as sdk 2.17.0/2.18.0).
- `grep -n "?? 'direct'" dist/agent/actions.js` finds the fallback at the **same 5 line numbers** as previously observed on sdk 2.17.0/2.18.0: 944, 956, 1439, 4772, 4869.
- `apply_style` with **explicit** `changeMode:"tracked"`: tracked-change count goes 0 → 1, and the change carries a real formatting-delta summary (`paragraph formatting revision: style: ∅ → Heading2, paragraphStyle: ∅ → Heading2`) — proves the action is genuinely tracked-capable.
- The identical `apply_style` call with `changeMode` **omitted**: `status: "ok"`, tracked-change count stays 0 → 0 — the edit applied, untracked, with no error, warning, or distinguishing field in the receipt.
- `move_table` on an annotation-bearing table, called with explicit `changeMode:"tracked"`: `status:"failed"`, `errors:[{code:"CAPABILITY_UNAVAILABLE", message:"tables.move (tracked): the table carries comment/bookmark/permission anchors that cannot yet be safely duplicated."}]` — unchanged from prior versions. This is a distinct, explicit, well-signaled capability gate, not the silent-default-to-direct defect — included here only to confirm it is not conflated with the real bug.

Full raw output: `results-2.23.0.json`.

## Root cause / analysis

Multiple call sites inside `dist/agent/actions.js` read `args.changeMode ??
'direct'` (or the equivalent inline) directly, rather than consulting the
host/client's configured `defaultChangeMode` when the caller doesn't pass
one explicitly. `getActionDispositions()`'s "tracked" classification
describes whether an action is *capable* of producing a tracked change when
asked — it says nothing about what happens when the caller doesn't ask. The
two are easy to conflate (a capability table audit can conclude "this is
tracked," while the actual per-call default is silently direct).

## Suggested fix

Have the `changeMode ?? 'direct'` fallback sites consult the client's
configured default change mode (if any) before falling back to `"direct"`,
and have the action's result/receipt explicitly report which mode was used
(not just a bare `status:"ok"`) so a caller — or anything auditing the
receipt stream — can detect an unattributed edit after the fact. Possible
workaround for integrators until fixed: always pass `changeMode` explicitly
on every action call rather than relying on a host default, and treat a
tracked-capable action's receipt as suspect if it doesn't echo back the
change mode actually used.

## Related

SD-26 (same agent action-runtime file, `dist/agent/actions.js`); SD-06,
SD-07, SD-08, SD-25, SD-40 (deleted-text group, separate root causes).
