# SD-05 — `ui.trackChanges.acceptAll()` / `rejectAll()` — FIXED on 2.23.0

## Summary
Earlier SuperDoc versions (2.7.1 → 2.10.0, not re-checked in a browser on 2.19+) reported
success from `ui.trackChanges.acceptAll()` / `rejectAll()` while leaving every tracked
change in place — documented as legacy v2 compatibility shims, with
`trackChanges.decide({target:{kind:"all"}})` as the real path. On 2.23.0, these calls (now
accessed through the public `createSuperDocUI()` handle, `ui.trackChanges.acceptAll` /
`acceptAllAsync` / `rejectAllAsync`) correctly decide every tracked change in the document.

## Environment
- **2.23.0** (this report): **fixed** — verified live in a real Chromium browser.
- 2.7.1 → 2.10.0 (prior research): reproduced as a no-op shim.
- 2.19+ was never previously re-checked in a browser before this report.

## Steps to reproduce (what we ran)
1. Open `_fixtures/dpa-multi-redline.docx` (37 tracked changes: 31 insertions-worth of
   paired/standalone revisions) in a bare `new SuperDoc(...)` mount, editing mode.
2. Read `doc.trackChanges.list().total` → 37.
3. Call `ui.trackChanges.acceptAll()` (synchronous form).
4. Re-read `doc.trackChanges.list().total`.
5. Repeat with `acceptAllAsync()` and `rejectAllAsync()` on fresh instances of the same
   document.

UI equivalent: open the document, trigger "Accept all changes" (or "Reject all changes")
from the review UI, and check the tracked-changes count.

`node SD-05/repro.mjs`.

## Expected / Actual
- **Expected (old bug):** count stays at 37; call reports success anyway.
- **Actual (2.23.0):** count goes from 37 to **0** for all three calls.
  - `acceptAll()` (sync): `before: 37, result: true, after: 0`.
  - `acceptAllAsync()`: `before: 37, resultSuccess: true, removedCount: 37, after: 0`.
  - `rejectAllAsync()`: `before: 37, resultSuccess: true, removedCount: 37, after: 0`.
  - The async variants resolve a full Document API receipt (`success`, `removed: [...37
    entity addresses...]`, `invalidatedRefs`, `affectedStories`, `txId`) — not a bare
    boolean.

## Evidence
`repro.mjs` → `results-2.23.0.json`; screenshot `screenshot-after-acceptAll.png` (shows a
clean document with the redline markup gone).

## Root cause / analysis
Not applicable — this is a FIXED report, not a live bug. The command descriptor approach
in 2.23.0 (see SD-103's `commands.d.ts` findings) and the richer `ui.trackChanges` handle
(`acceptAll`/`acceptAllAsync`/`rejectAll`/`rejectAllAsync`, each documented as "Returns the
Document API receipt, or `false` when bulk decisions are unavailable/disabled on the
host") suggest these calls now properly delegate to the engine's bulk-decide path instead
of acting as inert legacy shims.

## Suggested fix
None needed — reporting as fixed per the verdict rules.

## Related
SD-14 (batch decide by ids), SD-15 (id remapping across decisions), SD-16 (decide()
resolve-vs-throw on refusal) — other `trackChanges.decide()`-adjacent issues, separately
re-verified.
