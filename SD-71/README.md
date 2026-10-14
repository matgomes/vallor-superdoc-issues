# SD-71 — SDK host process crash under load (NEEDS REPRO on 2.23.0 / sdk 2.20.0)

## Summary

Internally reported symptom: the `@superdoc/sdk` host process (a persistent `superdoc host --stdio`
subprocess the SDK spawns once per client and reuses across every `open()`/`invoke()` call) has
been observed crashing in production — `SuperDocCliError: Host process disconnected` at roughly
1.98 GB resident, and `Host watchdog timed out waiting for cli.invoke` seven times in 1.5 hours —
during long-running agent sessions on large tracked-change documents in collaboration rooms. If
real, any sufficiently long agent session editing documents through the SDK risks the host process
being OOM-killed or becoming unresponsive mid-session, silently failing whatever operation was in
flight. This report ran a 200-iteration sustained-load stress test against a heavy tracked-changes
document and did **not** reproduce a crash, though it does show real, non-trivial, step-wise memory
growth in the host process — useful data even without a crash.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: NEEDS REPRO** — no crash after 200 sequential
  open/read/export/close cycles (this report).
- Original report: sdk 2.15–2.17, long-running agent sessions in collaboration rooms, production.
- No browser involved — pure headless `@superdoc/sdk`, one `createSuperDocClient({runtime:"v2"})`,
  connected once and reused across every iteration (matching how the host process is actually
  shared across a client's lifetime).

## Fixture

`synthetic-2000-tracked-insertions.docx` — the same synthetic, no-real-content fixture introduced
for the companion performance report on this document family (400 paragraphs × 4 runs, every run
and paragraph mark its own tracked insertion, 2,000 revisions total by one author/timestamp). This
is the heaviest tracked-change load available in this batch's fixture set, chosen specifically
because the original report's crashes were on "large tracked document[s]" in agent sessions.

## Steps to reproduce (attempted)

```bash
node SD-71/repro.mjs
```
1. Create **one** `@superdoc/sdk` client and `connect()` once (the host process is spawned here and
   reused for the rest of the run, matching production's one-host-per-client-lifetime model).
2. Identify the host process's OS pid by diffing the set of `superdoc`-named processes before and
   after `connect()` (robust to other concurrent `superdoc host` processes from unrelated work in
   the same environment).
3. Loop up to 200 times (capped at 10 minutes wall clock, whichever comes first): `open()` the
   fixture, call `trackChanges.list({limit:50})`, `comments.list()`, `export.toDocx({mode:"original"})`,
   then `close({discard:true})` — i.e. read-heavy operations representative of an agent inspecting
   a document, without committing new edits.
4. After every iteration, sample the host process's resident memory (`ps -o rss=`) and log it.
5. Catch any thrown error from an `invoke` call; stop and record it as a crash if one occurs.

## Expected / Actual

**Expected (if the bug reproduces):** the host process's RSS climbs toward ~2 GB and/or an
`invoke` call eventually throws `SuperDocCliError` ("Host process disconnected" or "Host watchdog
timed out waiting for cli.invoke").

**Actual:** completed all 200 iterations (~74 seconds wall clock) without any error. `client.dispose()`
afterward succeeded cleanly. The host process's RSS did grow, but it **plateaued well short of the
~2 GB crash threshold**, in a step pattern rather than a steady climb:

| iteration | RSS (MB) |
|---|---|
| 1 | 375 |
| 5 | 510 |
| 10 | 518 |
| 20 | 530 |
| 50 | 584 |
| 100 | 589 |
| 130 | 589 |
| 140 | 618 |
| 150–190 | 618–619 |
| 200 | 620 |

Growth is front-loaded (375→518 MB in the first 10 iterations, i.e. most of it is a one-time
warm-up cost), then largely flat for ~120 iterations, then one more step up to ~618 MB around
iteration 140, then flat again through iteration 200. This does not look like an unbounded
per-iteration leak; it looks like a small number of discrete cache/pool growth events, each of
which stabilizes.

## Evidence

`results-2.23.0.json`: full memory curve (one entry per iteration), `hostPid`, `crashInfo.crashed:
false`, `disposeOutcome.succeeded: true`, `startRssMb: 375`, `peakRssMb: 620`.

## Root cause / analysis

Not confirmed on 2.23.0 — no crash occurred, so no code path could be implicated. Several concrete
differences between this test and the original production conditions are worth naming as
hypotheses for why this run plateaued well under the ~2 GB threshold instead of crashing:

1. **Read-only vs. mutating load.** This test only lists/exports/closes-with-discard; it never
   commits an actual edit (`insert`/`replace`/`trackChanges.decide`, etc.). The original report
   came from active agent editing sessions, which may accumulate different (and larger) per-session
   state — e.g. undo/redo history, dirty-document tracking, or collaboration sync buffers — than a
   purely read-and-discard loop.
2. **No collaboration room.** The original crashes were "in rooms" (collaboration sessions); this
   test opens the fixture locally each time, with no Hocuspocus/Yjs layer at all. If the leak is in
   collaboration-specific state (awareness, sync protocol buffers, per-room caches) rather than in
   the base document-open/close path, a non-collaborative stress test would not reach it.
3. **Duration and concurrency.** 200 iterations completed in ~74 seconds. The original report's
   "7 times in 1.5h" figure implies sustained operation over hours, not under two minutes, and
   production usage likely involves multiple concurrent sessions/rooms sharing host/worker
   resources rather than one client cycling through documents sequentially. A slow, multi-hour
   accumulation (e.g. a cache that evicts on a timer rather than on pressure) would not show up in
   a 74-second run regardless of iteration count.
4. **Same document every time.** Reusing one fixture repeatedly may hit warm caches (e.g. a
   per-document-hash cache) that a continuously varied stream of real documents would not.

## Suggested fix

Not applicable until reproduced. If the vendor can reproduce this with mutating operations and/or
inside an active collaboration room over a longer duration, the general direction indicated by
"Host watchdog timed out waiting for cli.invoke" repeating multiple times before an eventual
"Host process disconnected" is worth investigating as a slow resource leak in the long-lived host
process's per-session or per-room state that is never fully released, eventually exhausting memory
or causing the host to stop responding to new `cli.invoke` calls in time.

**Possible workaround:** none identified from this (non-reproducing) test. If a production agent
session is long-running and editing large tracked-change documents in a collaboration room,
periodically recycling the SDK client (dispose and reconnect) would bound any such per-host-process
accumulation, at the cost of a brief reconnect pause.

## Related

None in this batch. Shares its fixture with the separate browser-rendering performance report on
the same large-tracked-document family (a different process — the browser bundle, not the SDK host
— and a different symptom: slow scroll/click/edit rather than a crash).
