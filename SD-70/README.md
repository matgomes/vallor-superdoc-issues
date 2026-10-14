# SD-70 — `onReady` vs. collaboration-room readiness race (NEEDS REPRO on 2.23.0)

## Summary

Internally reported symptom: calling `comments.list()` immediately after `onReady` fires in a
collaboration session can fail with `PRECONDITION_FAILED` / a `WorkerTransportError`, because
`onReady` is believed to fire before the collaboration room has committed its first story
mutation — there is no separate "room is actually initialized" signal distinct from "the UI
mounted." This would matter for any integrator (including an LLM agent driving the document)
that reads document state right after open, e.g. on fast clause-to-clause navigation. This report
could **not** trigger the failure on 2.23.0 after a reasonably thorough attempt — see below — so
the verdict is NEEDS REPRO, not REPRODUCES.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: NEEDS REPRO** — could not trigger `PRECONDITION_FAILED`
  or any comparable failure via script (this report).
- Not previously tested on 2.20.0/2.21.0 (no prior repro existed for this issue).
- Bare Hocuspocus 2.15.3 (`harness/lib/collab-server.mjs`), no Redis, no persistence extension.

## Steps to reproduce (attempted)

```bash
node SD-70/repro.mjs
```
For 3 independent attempts, each against a **brand-new** collaboration room (fresh room id, never
created before — maximizing the chance of catching a race against the room's first mutation):
1. Start a bare Hocuspocus server.
2. Open a browser SuperDoc instance with `roomMode: "create"` and local seed data (one comment),
   i.e. this browser session is the one creating the room, not joining an already-stable one.
3. The instant `window.__ready` resolves (immediately after `onReady` fires, no artificial delay),
   call both `ui.comments.list()` and `window.__sd.activeEditor.doc.comments.list()` in the same
   evaluate call and capture success/failure for each.

Also tried, headlessly via `@superdoc/sdk` (`harness/lib/sdk.mjs`'s `openDocx` with
`collaboration: { roomMode: "create" }`, no browser at all):
4. Immediately after `client.open()` resolves (the SDK's equivalent readiness signal), call
   `document.comments.list()`.
5. Repeated step 4 across 15 **concurrent** room creations (`Promise.all`), to maximize contention
   against the Hocuspocus server's internal state at open time.

## Expected / Actual

**Expected (if the bug reproduces):** `comments.list()` called immediately after readiness in a
freshly-created room throws or rejects with a `PRECONDITION_FAILED`-shaped error on at least one
attempt.

**Actual:** every attempt succeeded, across both browser paths and the headless SDK path, across
both sequential and concurrent fresh-room creation:

| path | attempts | failures |
|---|---|---|
| browser `ui.comments.list()` immediately after `onReady`, fresh room | 3 | 0 |
| browser `doc.comments.list()` immediately after `onReady`, fresh room | 3 | 0 |
| headless SDK `document.comments.list()` immediately after `open()`, fresh room, sequential | 1 | 0 |
| headless SDK `document.comments.list()` immediately after `open()`, 15 fresh rooms concurrently | 15 | 0 |

No `onException`, no console error, no rejected promise in any attempt.

**Related observation (not the reported bug, but worth noting for context):** `doc.comments.list()`
always returned the seeded comment correctly and immediately. `ui.comments.list()` — the separate
reactive UI facade from `createSuperDocUI` — returned an **empty array** immediately after
`onReady` in a non-collaboration, non-raced test elsewhere in this batch (see SD-55/SD-52), and
populates correctly after roughly a second. That is a real, reproducible async-population delay in
`ui.comments`, but it resolves silently (no error/exception) rather than throwing
`PRECONDITION_FAILED`, so it does not match this report's symptom — it's a plausible *adjacent*
timing issue, not confirmation of this one.

## Evidence

`results-2.23.0.json` (full raw output of all 3 fresh-room browser attempts, both API surfaces).
Screenshots (`screenshots/`): `attempt-1.png` through `attempt-3.png`, each showing the document
loaded normally with the seeded comment visible — no error card in any attempt.

## Root cause / analysis

Not confirmed on 2.23.0. The internally-reported mechanism (worth stating as the working
hypothesis for the vendor, even though unconfirmed here): the collaboration worker may require at
least one committed story mutation before some read paths succeed, and `onReady` may fire on a
different, earlier signal (e.g. "editor mounted and rendering") than "collaboration room
transport fully synced." If that race exists, it is likely narrower or more specific than "any
`comments.list()` call right after `onReady`" — e.g. it may depend on network/server latency this
local bare-Hocuspocus setup does not reproduce (a bare in-memory Hocuspocus server with no
persistence or auth overhead responds far faster than a production collaboration backend would),
or on a particular sequence of events (e.g. a concurrent browser-and-agent room creation race,
rather than a single client creating and immediately reading its own room).

## Suggested fix

Not applicable until reproduced — no fix can be meaningfully suggested for an unconfirmed race.
If the vendor can reproduce this internally, the general direction suggested by the original
symptom description would be: expose a distinct "collaboration room ready" signal (separate from
`onReady`) that callers needing to read collaboration-backed document state can await, rather than
relying on `onReady` alone.

**Possible workaround:** none needed, since the failure was not reproduced here. If it does occur
in a slower/production collaboration backend, a defensive retry with backoff around the first
`comments.list()` call after opening a collaboration document would be a reasonable integrator-side
mitigation until a dedicated readiness signal exists.

## Related

SD-60 (another collaboration room lifecycle/error-handling bug), SD-51 (comment markers staying
stale during active collaboration edit streams), SD-55/SD-52 (the separate, confirmed `ui.comments`
async-population delay noted above as an adjacent but distinct timing quirk).
